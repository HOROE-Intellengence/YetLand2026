import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Hono } from 'hono';
import { VoiceAsrLinkResponseSchema } from '@yelan/shared';
import { store } from '../store/persistence';
import { createVoiceRoute } from '../routes/voice';
import { createVoiceAsrAssetsRoute } from '../routes/voice-asr-assets';
import { VoiceDatabase, type VoiceAsset } from './database';
import { createAsrAudioLink, verifyAsrAudioLink } from './asr-signing';
import { hash } from './audio';

// 只使用隔离目录和内存请求；不读取真实 key、不访问公网、不发起 ASR。
describe('ASR signed input audio', () => {
  let root: string, db: VoiceDatabase, input: VoiceAsset, other: VoiceAsset, output: VoiceAsset;
  const bytes = Buffer.from('OggS-example-persisted-audio');
  const auth = (id = 'one') => ({ Authorization: `Bearer token-${id}` });
  beforeEach(async () => {
    store.__resetForTests();
    for (const id of ['one', 'two']) {
      store.state().users[id] = { id, token: `token-${id}`, ageVerified: true, narrativeBoundary: 2,
        ifUnlocked: false, createdAt: new Date().toISOString(), candle: 0, registerGrant: 0, conversationRounds: 0 };
      store.state().tokenIndex[`token-${id}`] = id;
    }
    vi.stubEnv('DEPLOY_MODE', 'server');
    vi.stubEnv('VOICE_ASR_PUBLIC_ORIGIN', 'https://voice.example.com');
    vi.stubEnv('VOICE_ASR_SIGNING_KEY', 'unit-test-secret-000000000000000000000001');
    vi.stubEnv('VOICE_ASR_SIGNING_TTL_SECONDS', '900');
    root = await mkdtemp(join(tmpdir(), 'yelan-asr-signature-')); db = new VoiceDatabase(root);
    await mkdir(join(root, 'assets'));
    async function seed(userId: string, direction: 'input' | 'output'): Promise<VoiceAsset> {
      const sessionId = randomUUID(), turnId = randomUUID(), id = randomUUID();
      db.db.prepare('INSERT INTO sessions VALUES (?,?,?,?,?,NULL)').run(sessionId, userId, 'role', 'Leda', 'now');
      db.db.prepare(`INSERT INTO turns (id,sessionId,requestId,inputHash,status,createdAt,updatedAt,prompt,promptHash,model)
        VALUES (?,?,?,?,'complete','now','now','','','test')`).run(turnId, sessionId, randomUUID(), hash(bytes));
      const asset: VoiceAsset = { id, userId, turnId, direction, filename: `${id}.ogg`, bytes: bytes.length,
        sha256: hash(bytes), durationMs: 1000, createdAt: 'now' };
      db.addAsset(asset); await writeFile(join(root, 'assets', asset.filename), bytes); return asset;
    }
    input = await seed('one', 'input'); other = await seed('two', 'input'); output = await seed('one', 'output');
  });
  afterEach(async () => {
    db.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks();
  });
  function app() {
    const app = new Hono();
    app.route('/api/voice/asr-assets', createVoiceAsrAssetsRoute(() => db));
    // 与真实挂载顺序一致，证明不会要求阿里传用户 token，也不绕过原音频鉴权。
    app.route('/api/voice', createVoiceRoute(() => { throw new Error('Live service must not initialize'); }));
    return app;
  }
  function signed(asset = input, now = Date.now()) {
    const result = createAsrAudioLink(asset, asset.userId, now);
    expect(result.skipped).toBe(false);
    if (result.skipped) throw new Error('Expected server URL');
    return new URL(result.url);
  }
  it('issues only to the owner, then accepts unauthenticated GET/HEAD and byte ranges', async () => {
    const server = app();
    expect((await server.request(`/api/voice/asr-assets/${input.id}/sign`, { method: 'POST' })).status).toBe(401);
    expect((await server.request(`/api/voice/asr-assets/${input.id}/sign`, { method: 'POST', headers: auth('two') })).status).toBe(404);
    const response = await server.request(`/api/voice/asr-assets/${input.id}/sign`, { method: 'POST', headers: { ...auth(), Host: 'attacker.example.com', 'X-Forwarded-Host': 'attacker.example.com' } });
    const link = VoiceAsrLinkResponseSchema.parse(await response.json());
    expect(response.status).toBe(200); expect(link.skipped).toBe(false);
    if (link.skipped) throw new Error('Missing signed URL');
    expect(new URL(link.url).origin).toBe('https://voice.example.com');
    const full = await server.request(link.url);
    expect(full.status).toBe(200); expect(Buffer.from(await full.arrayBuffer())).toEqual(bytes);
    expect(full.headers.get('Cache-Control')).toContain('no-store');
    const head = await server.request(link.url, { method: 'HEAD' });
    expect(head.status).toBe(200); expect(head.headers.get('Content-Length')).toBe(String(bytes.length));
    expect(await head.text()).toBe('');
    const partial = await server.request(link.url, { headers: { Range: 'bytes=1-5' } });
    expect(partial.status).toBe(206); expect(Buffer.from(await partial.arrayBuffer())).toEqual(bytes.subarray(1, 6));
    expect((await server.request(link.url, { headers: { Range: 'bytes=-0' } })).status).toBe(416);
    expect((await server.request(link.url, { headers: { Range: 'bytes=999-' } })).status).toBe(416);
    expect((await server.request(`/api/voice/assets/${input.id}`)).status).toBe(401);
  });
  it('local returns an explicit skip and never exposes the signed download route', async () => {
    const link = signed(); vi.stubEnv('DEPLOY_MODE', 'local');
    vi.stubEnv('VOICE_ASR_PUBLIC_ORIGIN', ''); vi.stubEnv('VOICE_ASR_SIGNING_KEY', '');
    const server = app();
    const response = await server.request(`/api/voice/asr-assets/${input.id}/sign`, { method: 'POST', headers: auth() });
    expect(await response.json()).toEqual({ skipped: true, reason: 'LOCAL_SIGNATURE_SKIPPED', url: null, expiresAt: null });
    expect((await server.request(link.href)).status).toBe(404);
    expect(verifyAsrAudioLink(input, link.searchParams)).toBe(false);
  });
  it('rejects modified expiry, substituted asset, malformed signatures and duplicate parameters', async () => {
    const server = app(), original = signed();
    for (const mutate of [
      (u: URL) => u.searchParams.set('expires', String(Number(u.searchParams.get('expires')) + 60)),
      (u: URL) => { u.pathname = `/api/voice/asr-assets/${other.id}`; },
      (u: URL) => u.searchParams.set('signature', '00'),
      (u: URL) => u.searchParams.append('expires', u.searchParams.get('expires')!),
      (u: URL) => u.searchParams.delete('signature'),
      (u: URL) => u.searchParams.set('anything', 'extra'),
    ]) {
      const changed = new URL(original); mutate(changed);
      expect((await server.request(changed.href)).status).toBe(403);
    }
    expect((await server.request(`/api/voice/asr-assets/${input.id}`)).status).toBe(403);
    expect((await server.request(original.href, { method: 'POST' })).status).not.toBe(200);
  });
  it('expires at the deadline and revokes on key, origin, owner or content changes', () => {
    const now = Date.now(), link = signed(input, now);
    expect(verifyAsrAudioLink(input, link.searchParams, now + 900_000)).toBe(false);
    expect(verifyAsrAudioLink({ ...input, userId: 'two' }, link.searchParams, now)).toBe(false);
    expect(verifyAsrAudioLink({ ...input, sha256: hash('different') }, link.searchParams, now)).toBe(false);
    vi.stubEnv('VOICE_ASR_PUBLIC_ORIGIN', 'https://different.example.com');
    expect(verifyAsrAudioLink(input, link.searchParams, now)).toBe(false);
    vi.stubEnv('VOICE_ASR_PUBLIC_ORIGIN', 'https://voice.example.com');
    vi.stubEnv('VOICE_ASR_SIGNING_KEY', 'unit-test-secret-000000000000000000000002');
    expect(verifyAsrAudioLink(input, link.searchParams, now)).toBe(false);
  });
  it('does not sign generated replies or another user input', async () => {
    expect(() => createAsrAudioLink(input, 'two')).toThrow('VOICE_ASSET_NOT_FOUND');
    expect(() => createAsrAudioLink(output, 'one')).toThrow('VOICE_ASSET_NOT_FOUND');
    expect((await app().request(`/api/voice/asr-assets/${output.id}/sign`, { method: 'POST', headers: auth() })).status).toBe(404);
  });
  it('server fails closed on missing key, unsafe origin or invalid TTL', async () => {
    for (const [key, value] of [
      ['VOICE_ASR_SIGNING_KEY', 'short'], ['VOICE_ASR_PUBLIC_ORIGIN', 'http://voice.example.com'],
      ['VOICE_ASR_PUBLIC_ORIGIN', 'https://127.0.0.1'], ['VOICE_ASR_PUBLIC_ORIGIN', 'https://localhost'],
      ['VOICE_ASR_PUBLIC_ORIGIN', 'https://a.example.com/path'], ['VOICE_ASR_SIGNING_TTL_SECONDS', '86400'],
    ] as const) {
      const previous = process.env[key]!; vi.stubEnv(key, value);
      const response = await app().request(`/api/voice/asr-assets/${input.id}/sign`, { method: 'POST', headers: auth() });
      expect(response.status).toBe(503); expect(await response.json()).toEqual({ code: 'VOICE_ASR_SIGNING_NOT_CONFIGURED' });
      vi.stubEnv(key, previous);
    }
  });
  it('detects changed file bytes even if database metadata is unchanged', async () => {
    const link = signed(); await writeFile(join(root, 'assets', input.filename), 'corrupt');
    const response = await app().request(link.href);
    expect(response.status).toBe(500); expect(await response.json()).toEqual({ code: 'AUDIO_INTEGRITY_FAILED' });
  });
});
