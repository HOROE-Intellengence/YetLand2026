import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import type { AddressInfo } from 'node:net';
import { store } from '../store/persistence';
import { charactersService } from '../services/characters';
import { preludeCardsService, VOICE_PRELUDE_ID } from '../services/prelude-cards';
import { adminPreludeCardsRoute } from '../routes/admin/prelude-cards';
import { adminCharactersRoute } from '../routes/admin/characters';
import { mockCreatedCharactersRoute } from '../routes/me/created-characters';
import { mockCharactersRoute } from '../routes/characters';
import { loadCharacterCard } from '../prompts/loader';
import { VoiceDatabase } from './database';
import { VoiceService } from './service';
import { createVoiceRoute } from '../routes/voice';
import { decodeAudio, hash } from './audio';
import { relayConfig, VoiceError } from './config';
import type { LiveRequest } from './live';

function wav(seconds = 0.2): Buffer {
  const pcm = Buffer.alloc(Math.round(16000 * seconds) * 2);
  for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(2000 * Math.sin(i / 16000 * Math.PI * 880)), i * 2);
  const h = Buffer.alloc(44); h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
function seedUser(id: string): void {
  store.state().users[id] = {
    id, token: `token-${id}`, ageVerified: true, narrativeBoundary: 2, ifUnlocked: false,
    createdAt: new Date().toISOString(), candle: 100, registerGrant: 100, conversationRounds: 0,
  };
  store.state().tokenIndex[`token-${id}`] = id;
}
const auth = (user = 'one') => ({ Authorization: `Bearer token-${user}` });
const progress = { inputText: '你好', outputText: '你好呀', inputTranscriptComplete: true, outputTranscriptComplete: true, usage: { totalTokenCount: 12 } };
const fakeGenerate = async (req: LiveRequest) => {
  req.onAudio(Buffer.alloc(24000 / 5 * 2, 1)); req.onProgress(progress); return progress;
};

describe('voice backend with real SQLite and FFmpeg', () => {
  let root: string, db: VoiceDatabase, service: VoiceService;
  beforeEach(async () => {
    store.__resetForTests(); seedUser('one'); seedUser('two');
    charactersService.upsert({ id: 'builtin', slug: 'builtin', name: '测试角色', rarity: 'free', priceCandle: 0,
      boundaryDefault: 2, description: '只属于角色的设定', profileSections: [{ key: '习惯', value: '喜欢散步', order: 0 }] });
    preludeCardsService.upsert({ id: VOICE_PRELUDE_ID, name: '语音前置', content: '专用前置原文', scope: 'voice' });
    root = await mkdtemp(join(tmpdir(), 'yelan-voice-test-'));
    db = new VoiceDatabase(root); service = new VoiceService(db, fakeGenerate);
    vi.stubEnv('VOICE_RELAY_URL', 'ws://127.0.0.1:8790/google-live');
    vi.stubEnv('VOICE_RELAY_TOKEN', 'test-relay-token-00000000000000000000');
    vi.stubEnv('DEPLOY_MODE', 'local');
  });
  afterEach(async () => {
    await vi.waitFor(() => expect(service.jobs.size).toBe(0), { timeout: 10_000 });
    db.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.restoreAllMocks();
  });
  async function completed(id: string) {
    await vi.waitFor(() => expect(db.turn(id)?.status).toBe('complete'), { timeout: 10_000 });
    return db.turn(id)!;
  }
  it('persists administrator voice binding, ignores client overrides, and refreshes restored sessions next turn', async () => {
    const generate = vi.fn(fakeGenerate);
    service = new VoiceService(db, generate);
    const patch = (body: unknown) => adminCharactersRoute.request('/builtin', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    expect((await patch({ voiceName: 'Charon', reason: 'voice binding test' })).status).toBe(200);
    expect(store.state().characters.builtin?.voiceName).toBe('Charon');
    const app = createVoiceRoute(() => service);
    const created = await app.request('/sessions', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: 'builtin', voiceName: 'Puck' }),
    });
    expect(created.status).toBe(201);
    const session = await created.json() as { id: string; voiceName: string };
    expect(session.voiceName).toBe('Charon');
    const first = await service.start('one', session.id, randomUUID(), wav()); await completed(first.id);
    expect(generate.mock.calls[0]![0].voiceName).toBe('Charon');
    expect((await patch({ voiceName: 'Gacrux', reason: 'change binding' })).status).toBe(200);
    const second = await service.start('one', session.id, randomUUID(), wav()); await completed(second.id);
    expect(generate.mock.calls[1]![0].voiceName).toBe('Gacrux');
    expect(db.session(session.id)?.voiceName).toBe('Gacrux');
    expect(db.turn(first.id)?.outputAssetId).toBeTruthy();
    expect((await patch({ name: '新名字', reason: 'unrelated edit' })).status).toBe(200);
    expect(charactersService.get('builtin')?.voiceName).toBe('Gacrux');
    expect((await patch({ voiceName: 'invalid', reason: 'invalid binding' })).status).toBe(400);
  });
  it('uses the voice selected during private character creation and keeps other users excluded', async () => {
    const response = await mockCreatedCharactersRoute.request('/', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '我的语音角色', voiceName: 'Puck', consent: true, makePublic: false }),
    });
    expect(response.status).toBe(201);
    const { character } = await response.json() as { character: { id: string; voiceName: string } };
    expect(character.voiceName).toBe('Puck');
    expect(store.state().characters[character.id]?.voiceName).toBe('Puck');
    const ownList = await (await mockCharactersRoute.request('/', { headers: auth() })).json() as { id: string }[];
    const otherList = await (await mockCharactersRoute.request('/', { headers: auth('two') })).json() as { id: string }[];
    expect(ownList.some(c => c.id === character.id)).toBe(true);
    expect(otherList.some(c => c.id === character.id)).toBe(false);
    const generate = vi.fn(fakeGenerate); service = new VoiceService(db, generate);
    const session = service.create('one', character.id);
    expect(session.voiceName).toBe('Puck');
    const turn = await service.start('one', session.id, randomUUID(), wav()); await completed(turn.id);
    expect(generate.mock.calls[0]![0].voiceName).toBe('Puck');
    expect(() => service.create('two', character.id)).toThrow('CHARACTER_NOT_FOUND');
    const other = await createVoiceRoute(() => service).request(`/sessions/${session.id}`, { headers: auth('two') });
    expect(other.status).toBe(404);
  });
  it('keeps legacy cards usable with the default voice and rejects invalid user voice choices', async () => {
    delete store.state().characters.builtin!.voiceName;
    expect(charactersService.get('builtin')?.voiceName).toBe('Leda');
    expect(service.create('one', 'builtin', 'Charon').voiceName).toBe('Leda');
    const invalid = await mockCreatedCharactersRoute.request('/', {
      method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'bad', voiceName: 'unknown', consent: true }),
    });
    expect(invalid.status).toBe(400);
  });
  it('streams the first PCM before generation completes; reconnects by byte cursor without another generation', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const pcm = Buffer.alloc(9600, 1);
    const generate = vi.fn(async (req: LiveRequest) => {
      req.onAudio(pcm.subarray(0, 4800));
      await gate;
      req.onAudio(pcm.subarray(4800)); req.onProgress(progress); return progress;
    });
    service = new VoiceService(db, generate);
    const session = service.create('one', 'builtin', 'Leda');
    const turn = await service.start('one', session.id, randomUUID(), Buffer.alloc(0), '测试');
    const app = createVoiceRoute(() => service);
    const url = `/sessions/${session.id}/turns/${turn.id}/audio-stream`;
    try {
      expect((await app.request(url, { headers: auth('two') })).status).toBe(404);
      expect((await app.request(url)).status).toBe(401);
      expect((await app.request(`${url}?offset=1`, { headers: auth() })).status).toBe(400);
      const res = await app.request(url, { headers: auth() });
      const reader = res.body!.getReader();
      const first = await reader.read();
      expect(Buffer.from(first.value!)).toEqual(pcm.subarray(0, 4800));
      expect(db.turn(turn.id)?.status).toBe('processing');
      await reader.cancel();
      expect(service.jobs.size).toBe(1);
      release(); await completed(turn.id);
      // The journal is gone: completed Opus is decoded and resumed, still owner-only.
      const rest = await app.request(`${url}?offset=4800`, { headers: auth() });
      expect((await rest.arrayBuffer()).byteLength).toBe(4800);
      expect(generate).toHaveBeenCalledTimes(1);
      const saved = await app.request(`/sessions/${session.id}`, { headers: auth() });
      expect((await saved.json() as { closedAt: string | null }).closedAt).toBeNull();
    } finally { release(); }
  }, 20_000);
  it('saves both directions as playable Opus, survives restart, supports owner-only Range playback', async () => {
    const app = createVoiceRoute(() => service);
    const response = await app.request('/sessions', { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' }, body: JSON.stringify({ characterId: 'builtin', voiceName: 'Puck' }) });
    expect(response.status).toBe(201);
    const session = await response.json() as { id: string };
    const sent = await app.request(`/sessions/${session.id}/turns`, { method: 'POST', headers: { ...auth(), 'Content-Type': 'audio/wav', 'Idempotency-Key': randomUUID() }, body: new Uint8Array(wav()) });
    expect(sent.status).toBe(202);
    const body = await sent.json() as { id: string };
    const turn = await completed(body.id);
    expect(turn.inputText).toBe('你好'); expect(turn.outputText).toBe('你好呀');
    expect(turn.trainingConsent).toBe(0);
    expect(turn.prompt).toBe(`专用前置原文\n\n${loadCharacterCard('builtin')}`);
    for (const id of [turn.inputAssetId!, turn.outputAssetId!]) {
      const asset = db.asset(id)!;
      const audio = await readFile(join(root, 'assets', asset.filename));
      expect(audio.subarray(0, 4).toString()).toBe('OggS');
      expect(audio.includes(Buffer.from('OpusHead'))).toBe(true);
      expect((await decodeAudio(audio)).length).toBeGreaterThan(0);
      expect(audio.length).toBeLessThan(wav().length);
      expect(hash(audio)).toBe(asset.sha256);
      expect((await app.request(`/assets/${id}`, { headers: auth('two') })).status).toBe(404);
      const range = await app.request(`/assets/${id}`, { headers: { ...auth(), Range: 'bytes=0-3' } });
      expect(range.status).toBe(206); expect(await range.text()).toBe('OggS');
      expect((await app.request(`/assets/${id}`, { headers: { ...auth(), Range: 'bytes=999999999-' } })).status).toBe(416);
    }
    expect(await readdir(join(root, 'pending'))).toEqual([]);
    db.close(); db = new VoiceDatabase(root); db.recover(); service = new VoiceService(db, fakeGenerate);
    expect(db.turn(turn.id)?.status).toBe('complete');
    expect((await createVoiceRoute(() => service).request(`/assets/${turn.outputAssetId}`, { headers: auth() })).status).toBe(200);
  }, 20_000);
  it('handles private user cards and denies sessions and prompts to other users', async () => {
    const card = charactersService.createFromUser('one', { name: '我的角色', consent: true, makePublic: false });
    const session = service.create('one', card.id, 'Leda');
    expect(() => service.create('two', card.id, 'Leda')).toThrow('CHARACTER_NOT_FOUND');
    const app = createVoiceRoute(() => service);
    expect((await app.request(`/sessions/${session.id}/turns`, { headers: auth('two') })).status).toBe(404);
    expect((await app.request('/sessions', { method: 'POST', body: '{}' })).status).toBe(401);
    const turn = await service.start('one', session.id, randomUUID(), wav()); await completed(turn.id);
    expect(db.turn(turn.id)?.prompt).toContain('我的角色');
  });
  it('reuses an idempotency key without resubmission and rejects conflicting audio', async () => {
    const generate = vi.fn(fakeGenerate); service = new VoiceService(db, generate);
    const session = service.create('one', 'builtin', 'Leda'), key = randomUUID();
    const turn = await service.start('one', session.id, key, wav()); await completed(turn.id);
    expect((await service.start('one', session.id, key, wav())).id).toBe(turn.id);
    await expect(service.start('one', session.id, key, wav(0.3))).rejects.toThrow('VOICE_IDEMPOTENCY_CONFLICT');
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('loads only the updated voice prelude and character card, with real conversation history', async () => {
    const generate = vi.fn(fakeGenerate); service = new VoiceService(db, generate);
    const session = service.create('one', 'builtin', 'Charon');
    const one = await service.start('one', session.id, randomUUID(), wav()); await completed(one.id);
    const patch = await adminPreludeCardsRoute.request(`/${VOICE_PRELUDE_ID}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content: '后台修改后的原文', reason: 'test' }) });
    expect(patch.status).toBe(200);
    const two = await service.start('one', session.id, randomUUID(), wav()); await completed(two.id);
    const request = generate.mock.calls[1]![0];
    expect(request.prompt).toBe(`后台修改后的原文\n\n${loadCharacterCard('builtin')}`);
    expect(request.history).toEqual([{ role: 'user', parts: [{ text: '你好' }] }, { role: 'model', parts: [{ text: '你好呀' }] }]);
    charactersService.upsert({ ...charactersService.getRow('builtin')!, preludeCardId: VOICE_PRELUDE_ID });
    expect(preludeCardsService.resolveForChat('builtin', false)?.id).not.toBe(VOICE_PRELUDE_ID);
  });
  it('preserves partial audio on upstream failure and never reports completion', async () => {
    service = new VoiceService(db, async (req) => { req.onAudio(Buffer.alloc(9600, 1)); throw new VoiceError('VOICE_UPSTREAM_DISCONNECTED', 502); });
    const session = service.create('one', 'builtin', 'Leda');
    const turn = await service.start('one', session.id, randomUUID(), wav());
    await vi.waitFor(() => expect(db.turn(turn.id)?.status).toBe('failed'), { timeout: 5000 });
    expect(db.turn(turn.id)?.inputAssetId).toBeTruthy(); expect(db.turn(turn.id)?.outputAssetId).toBeTruthy();
    expect(db.turn(turn.id)?.errorCode).toBe('VOICE_UPSTREAM_DISCONNECTED');
  });
  it('never sends to the provider when input cannot be durably saved', async () => {
    const generate = vi.fn(fakeGenerate); service = new VoiceService(db, generate);
    const session = service.create('one', 'builtin', 'Leda');
    vi.spyOn(db, 'addAsset').mockImplementation(() => { throw new Error('disk full'); });
    await expect(service.start('one', session.id, randomUUID(), wav())).rejects.toThrow('VOICE_STORAGE_FAILED');
    expect(generate).not.toHaveBeenCalled(); expect(db.turns(session.id)[0]?.status).toBe('failed');
    expect(await readdir(join(root, 'assets'))).toEqual([]);
  });
  it('never marks the turn complete if output cannot be saved', async () => {
    const original = db.addAsset.bind(db);
    vi.spyOn(db, 'addAsset').mockImplementation((asset) => { if (asset.direction === 'output') throw new Error('disk full'); original(asset); });
    const session = service.create('one', 'builtin', 'Leda');
    const turn = await service.start('one', session.id, randomUUID(), wav());
    await vi.waitFor(() => expect(db.turn(turn.id)?.status).toBe('failed'), { timeout: 5000 });
    expect(db.turn(turn.id)?.outputAssetId).toBeNull();
    expect((await readFile(join(root, 'pending', `${turn.id}.pcm`))).length).toBeGreaterThan(0);
  });
  it('recovers an interrupted audio journal after restart without generating again', async () => {
    const session = service.create('one', 'builtin', 'Leda');
    const turn = await service.start('one', session.id, randomUUID(), wav()); await completed(turn.id);
    db.db.prepare("UPDATE turns SET status='processing',outputAssetId=NULL WHERE id=?").run(turn.id);
    db.db.prepare("DELETE FROM assets WHERE turnId=? AND direction='output'").run(turn.id);
    await mkdir(join(root, 'pending'), { recursive: true });
    await writeFile(join(root, 'pending', `${turn.id}.pcm`), Buffer.alloc(9600, 1));
    db.close(); db = new VoiceDatabase(root); db.recover();
    const generate = vi.fn(fakeGenerate); service = new VoiceService(db, generate); await service.ready;
    expect(db.turn(turn.id)?.status).toBe('interrupted'); expect(db.turn(turn.id)?.outputAssetId).toBeTruthy();
    expect(generate).not.toHaveBeenCalled();
  });
  it('rejects non-media uploads and enforces production WSS', async () => {
    await expect(decodeAudio(Buffer.from('#EXTM3U\nhttps://example.com'))).rejects.toThrow('AUDIO_FORMAT_UNSUPPORTED');
    vi.stubEnv('DEPLOY_MODE', 'server'); expect(() => relayConfig()).toThrow('VOICE_RELAY_NOT_CONFIGURED');
  });
  it('accepts Dev text through the authenticated route and persists a voice reply without inventing input audio', async () => {
    const generate = vi.fn(async (req: LiveRequest) => {
      req.onAudio(Buffer.alloc(9600, 1));
      const p = { ...progress, inputText: req.text!, inputTranscriptComplete: true };
      req.onProgress(p); return p;
    });
    service = new VoiceService(db, generate);
    const session = service.create('one', 'builtin', 'Leda');
    const app = createVoiceRoute(() => service), requestId = randomUUID();
    const options = { method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json', 'Idempotency-Key': requestId }, body: JSON.stringify({ text: '文字测试' }) };
    const res = await app.request(`/sessions/${session.id}/turns/text`, options);
    expect(res.status).toBe(202);
    const turn = await res.json() as { id: string }; await completed(turn.id);
    expect(db.turn(turn.id)).toMatchObject({ inputText: '文字测试', inputAssetId: null, inputTranscriptComplete: 1 });
    expect(db.turn(turn.id)?.outputAssetId).toBeTruthy();
    expect(generate.mock.calls[0]![0].text).toBe('文字测试');
    expect((await app.request(`/sessions/${session.id}/turns/text`, options)).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('rejects oversized or invalid media before generation and fails explicitly without relay config', async () => {
    const generate = vi.fn(fakeGenerate); service = new VoiceService(db, generate);
    const session = service.create('one', 'builtin', 'Leda');
    await expect(service.start('one', session.id, randomUUID(), wav(121))).rejects.toThrow('AUDIO_TOO_LONG');
    expect(generate).not.toHaveBeenCalled();
    vi.stubEnv('VOICE_RELAY_URL', '');
    await expect(service.start('one', session.id, randomUUID(), wav())).rejects.toThrow('VOICE_RELAY_NOT_CONFIGURED');
    expect(generate).not.toHaveBeenCalled();
  });
  it('allows one active turn per user, and closing preserves partial audio as interrupted', async () => {
    let connected = false;
    service = new VoiceService(db, async (req) => {
      req.onAudio(Buffer.alloc(9600, 1)); connected = true;
      return new Promise((_resolve, reject) => req.signal.addEventListener('abort', () => reject(new VoiceError('VOICE_CANCELLED', 409)), { once: true }));
    });
    const session = service.create('one', 'builtin', 'Leda');
    const turn = await service.start('one', session.id, randomUUID(), wav());
    await vi.waitFor(() => expect(connected).toBe(true));
    await expect(service.start('one', session.id, randomUUID(), wav())).rejects.toThrow('VOICE_USER_BUSY');
    service.closeSession(session.id, 'one');
    await vi.waitFor(() => expect(db.turn(turn.id)?.status).toBe('interrupted'), { timeout: 5000 });
    expect(db.turn(turn.id)?.outputAssetId).toBeTruthy();
    await expect(service.start('one', session.id, randomUUID(), wav())).rejects.toThrow('VOICE_SESSION_CLOSED');
  });
  it('restores audio history when transcripts are unavailable, with no synthesized summary', async () => {
    const generate = vi.fn(async (req: LiveRequest) => {
      req.onAudio(Buffer.alloc(9600, 1));
      const p = { ...progress, inputText: '', outputText: '', inputTranscriptComplete: false, outputTranscriptComplete: false };
      req.onProgress(p); return p;
    });
    service = new VoiceService(db, generate);
    const session = service.create('one', 'builtin', 'Leda');
    const first = await service.start('one', session.id, randomUUID(), wav()); await completed(first.id);
    const second = await service.start('one', session.id, randomUUID(), wav()); await completed(second.id);
    const request = generate.mock.calls[1]![0];
    expect(request.history).toHaveLength(2);
    expect(request.history[0]).toMatchObject({ role: 'user', parts: [{ inlineData: { mimeType: 'audio/pcm;rate=16000' } }] });
    expect(request.history[1]).toMatchObject({ role: 'model', parts: [{ inlineData: { mimeType: 'audio/pcm;rate=16000' } }] });
    expect(request.prompt).toBe(`专用前置原文\n\n${loadCharacterCard('builtin')}`);
  });
  it('keeps voice scope reserved, refuses disabled prompts, and does not resurrect them', async () => {
    const result = await adminPreludeCardsRoute.request(`/${VOICE_PRELUDE_ID}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'global', reason: 'test' }) });
    expect(result.status).toBe(400);
    preludeCardsService.disable(VOICE_PRELUDE_ID);
    expect(() => service.create('one', 'builtin', 'Leda')).toThrow('VOICE_PRELUDE_UNAVAILABLE');
    expect(preludeCardsService.get(VOICE_PRELUDE_ID)?.isActive).toBe(false);
  });
  it('speaks the real Live WebSocket protocol through a local fake upstream', async () => {
    const upstream = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => upstream.once('listening', resolve));
    const messages: Record<string, unknown>[] = [];
    let authorization = '';
    upstream.on('connection', (socket, req) => {
      authorization = req.headers.authorization ?? '';
      socket.on('message', (raw) => {
        const message = JSON.parse(raw.toString()); messages.push(message);
        if (message.setup) socket.send(JSON.stringify({ setupComplete: {} }));
        if (message.realtimeInput?.activityEnd) {
          socket.send(JSON.stringify({ serverContent: {
            inputTranscription: { text: '测试输入', finished: true },
            outputTranscription: { text: '测试回答', finished: true },
            modelTurn: { parts: [{ inlineData: { mimeType: 'audio/pcm;rate=24000', data: Buffer.alloc(9600, 1).toString('base64') } }] },
            generationComplete: true, turnComplete: true,
          } }));
        }
      });
    });
    try {
      vi.stubEnv('VOICE_RELAY_URL', `ws://127.0.0.1:${(upstream.address() as AddressInfo).port}/google-live`);
      service = new VoiceService(db);
      const session = service.create('one', 'builtin', 'Puck');
      const turn = await service.start('one', session.id, randomUUID(), wav()); await completed(turn.id);
      expect(authorization).toBe(`Bearer ${process.env.VOICE_RELAY_TOKEN}`);
      expect(messages[0]).toMatchObject({ setup: { model: 'models/gemini-3.8-live', systemInstruction: { parts: [{ text: turn.prompt }] } } });
      expect(messages.some((m) => Boolean(m.realtimeInput))).toBe(true);
      expect(db.turn(turn.id)?.outputText).toBe('测试回答');
    } finally {
      for (const client of upstream.clients) client.terminate();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  }, 15_000);
});
