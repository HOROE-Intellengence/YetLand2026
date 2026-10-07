import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { store } from '../store/persistence';
import { charactersService } from '../services/characters';
import { VoiceDatabase } from '../voice/database';
import { VoiceService } from '../voice/service';
import { VoiceError } from '../voice/config';
import { HqVoiceService, type HqDependencies } from './service';
import { createHqVoiceRoute } from '../routes/voice-hq';
import { adminCharactersRoute } from '../routes/admin/characters';
import { saveSlot } from './profiles';
import { ensureChatSession } from '../pipeline/chat-pipeline';
import { resolveIfUnlockFromText } from '../services/if-unlock';

function wav() {
  const pcm = Buffer.alloc(6400, 1), h = Buffer.alloc(44);
  h.write('RIFF'); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(16000, 24);
  h.writeUInt32LE(32000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}
describe('HQ voice persisted pipeline', () => {
  let root: string, db: VoiceDatabase, service: HqVoiceService, deps: HqDependencies;
  const auth = { Authorization: 'Bearer token-one' };
  beforeEach(async () => {
    store.__resetForTests();
    store.state().users.one = { id: 'one', token: 'token-one', ageVerified: true, narrativeBoundary: 2,
      ifUnlocked: false, createdAt: new Date().toISOString(), candle: 100, registerGrant: 100, conversationRounds: 0 };
    store.state().tokenIndex['token-one'] = 'one';
    charactersService.upsert({ id: 'test', slug: 'test', name: '测试', rarity: 'free', priceCandle: 0,
      boundaryDefault: 2, hqVoiceProfileId: 'young-female' });
    root = await mkdtemp(join(tmpdir(), 'yelan-hq-'));
    db = new VoiceDatabase(root);
    deps = { main: vi.fn(async () => ({ text: '这是完整回复，原文照读。', model: 'test-main' })),
      tts: vi.fn(async () => Buffer.alloc(9600, 1)), submit: vi.fn(async () => 'task-1'), poll: vi.fn(async () => '识别文本') };
    service = new HqVoiceService(db, deps);
    vi.stubEnv('DEPLOY_MODE', 'local'); vi.stubEnv('VOICE_HQ_FISH_API_KEY', 'test-key');
    vi.stubEnv('VOICE_HQ_ASR_API_KEY', 'test-asr');
    vi.stubEnv('VOICE_ASR_PUBLIC_ORIGIN', 'https://test.example');
    vi.stubEnv('VOICE_ASR_SIGNING_KEY', 'x'.repeat(40));
  });
  afterEach(async () => {
    for (const job of service.jobs.values()) job.abort();
    await vi.waitFor(() => expect(service.jobs.size).toBe(0), { timeout: 10000 });
    db.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs();
  });
  async function done(id: string, status = 'complete') {
    await vi.waitFor(() => expect(db.turn(id)?.status).toBe(status), { timeout: 10000 });
    return service.response(db.turn(id)!);
  }
  it('exposes session-scoped IF and the measured temperature, including restoration without leaking account unlock', async () => {
    store.state().ifCodes = [{ code: 'HQ-CIPHER', active: true, source: 'test', boundary: 3 }];
    vi.mocked(deps.main).mockImplementation(async input => {
      ensureChatSession({ id: input.sessionId, userId: input.userId, characterId: input.characterId });
      resolveIfUnlockFromText(input.userId, input.sessionId, input.text);
      input.onPrompt('measured prompt', 4);
      return { text: '完整回复', model: 'test-main' };
    });
    const s = service.create('one', 'test');
    expect(s.ifActive).toBe(false);
    const turn = await service.start('one', s.id, randomUUID(), Buffer.alloc(0), 'HQ-CIPHER');
    expect(await done(turn.id)).toMatchObject({ ifActive: true, temperature: 4 });
    const restored = new HqVoiceService(db, deps);
    expect(restored.describe(s.id, 'one').ifActive).toBe(true);
    expect(restored.response(db.turn(turn.id)!)).toMatchObject({ ifActive: true, temperature: 4 });
    expect(store.state().users.one?.ifUnlocked).toBe(true);
    expect(restored.create('one', 'test').ifActive).toBe(false);
    db.db.prepare("UPDATE hq_turns SET timings='{}' WHERE turnId=?").run(turn.id);
    expect(restored.response(db.turn(turn.id)!).temperature).toBeNull();
  });
  it('uses a Fish voice snapshot, sends exact main text to TTS and preserves full two-turn history', async () => {
    saveSlot(db, 'young-female', 'fish-test-ref', 1);
    const s = service.create('one', 'test'), key = randomUUID();
    const first = await service.start('one', s.id, key, Buffer.alloc(0), '你好');
    const result = await done(first.id);
    expect(result.outputAudioUrl).toBeTruthy(); expect(result.localAsrSkipped).toBe(true);
    expect(deps.submit).not.toHaveBeenCalled(); expect(deps.poll).not.toHaveBeenCalled();
    const args = vi.mocked(deps.tts).mock.calls[0]!;
    expect(args[0]).toBe(result.outputText);
    expect(args[1].referenceId).toBe('fish-test-ref'); expect(args[1].provider).toBe('fish'); expect(args[1].model).toBe('s2.1-pro-free');
    expect((await service.start('one', s.id, key, Buffer.alloc(0), '你好')).id).toBe(first.id);
    expect(deps.main).toHaveBeenCalledTimes(1); expect(deps.tts).toHaveBeenCalledTimes(1);
    await expect(service.start('one', s.id, key, Buffer.alloc(0), '不同')).rejects.toThrow('VOICE_IDEMPOTENCY_CONFLICT');
    const next = await service.start('one', s.id, randomUUID(), Buffer.alloc(0), '接着聊'); await done(next.id);
    expect(vi.mocked(deps.main).mock.calls[1]![0].history).toEqual([
      { role: 'user', content: '你好' }, { role: 'assistant', content: result.outputText },
    ]);
  });
  it('saves local recording but skips signing, ASR, main and TTS', async () => {
    const s = service.create('one', 'test');
    const t = await service.start('one', s.id, randomUUID(), wav());
    expect(t.stage).toBe('asr_skipped'); expect(t.errorCode).toBe('LOCAL_ASR_SKIPPED'); expect(t.inputAudioUrl).toBeTruthy();
    expect(deps.submit).not.toHaveBeenCalled(); expect(deps.main).not.toHaveBeenCalled(); expect(deps.tts).not.toHaveBeenCalled();
  });
  it('retries only TTS with the original profile snapshot after a binding change', async () => {
    vi.mocked(deps.tts).mockRejectedValueOnce(new VoiceError('HQ_TTS_FAILED', 502));
    const s = service.create('one', 'test');
    const t = await service.start('one', s.id, randomUUID(), Buffer.alloc(0), '重试');
    expect((await done(t.id, 'failed')).canRetryTts).toBe(true);
    store.state().characters.test!.hqVoiceProfileId = 'mature-male';
    const retryKey = randomUUID(); service.retry('one', s.id, t.id, retryKey, 'tts'); await done(t.id);
    service.retry('one', s.id, t.id, retryKey, 'tts');
    expect(deps.main).toHaveBeenCalledTimes(1); expect(deps.tts).toHaveBeenCalledTimes(2);
    expect(vi.mocked(deps.tts).mock.calls[1]![1].id).toBe('young-female');
  });
  it('resumes the saved ASR task without resubmission (mock server mode)', async () => {
    vi.stubEnv('DEPLOY_MODE', 'server');
    vi.mocked(deps.poll).mockRejectedValueOnce(new VoiceError('HQ_ASR_TIMEOUT', 504));
    const s = service.create('one', 'test'), t = await service.start('one', s.id, randomUUID(), wav());
    expect((await done(t.id, 'failed')).canResumeAsr).toBe(true);
    service.retry('one', s.id, t.id, randomUUID(), 'asr'); await done(t.id);
    expect(deps.submit).toHaveBeenCalledTimes(1); expect(deps.poll).toHaveBeenCalledTimes(2); expect(deps.main).toHaveBeenCalledTimes(1);
    expect(vi.mocked(deps.submit).mock.calls[0]![0]).toMatch(/^https:\/\/test.example\/api\/voice\/asr-assets\//);
  });
  it('never resubmits unknown ASR outcome', async () => {
    vi.stubEnv('DEPLOY_MODE', 'server'); vi.mocked(deps.submit).mockRejectedValue(new Error('network'));
    const s = service.create('one', 'test'), key = randomUUID(), t = await service.start('one', s.id, key, wav());
    const failed = await done(t.id, 'failed');
    expect(failed.errorCode).toBe('HQ_ASR_SUBMISSION_UNKNOWN'); expect(failed.canResumeAsr).toBe(false);
    await service.start('one', s.id, key, wav()); expect(deps.submit).toHaveBeenCalledTimes(1);
  });
  it('isolates owners and old Live sessions, blocks server text and client voice override', async () => {
    const s = service.create('one', 'test');
    expect(() => service.session(s.id, 'two')).toThrow('VOICE_SESSION_NOT_FOUND');
    expect(() => new VoiceService(db).session(s.id, 'one')).toThrow('VOICE_SESSION_NOT_FOUND');
    const route = createHqVoiceRoute(() => service);
    expect((await route.request('/config')).status).toBe(401);
    expect((await route.request('/sessions', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: 'test', profileId: 'mature-male' }) })).status).toBe(400);
    vi.stubEnv('DEPLOY_MODE', 'server');
    expect((await route.request(`/sessions/${s.id}/turns/text`, { method: 'POST', headers: auth })).status).toBe(404);
  });
  it('persists admin binding through unrelated edits and validates selection', async () => {
    const patch = (body: object) => adminCharactersRoute.request('/test', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, reason: 'test' }) });
    expect((await patch({ hqVoiceProfileId: 'mature-female' })).status).toBe(200);
    expect((await patch({ name: '新名字' })).status).toBe(200);
    expect(service.create('one', 'test').profileId).toBe('mature-female');
    expect((await patch({ hqVoiceProfileId: 'invalid' })).status).toBe(400);
  });
  it('restart leaves unknown processing interrupted and does not regenerate', async () => {
    const s = service.create('one', 'test'), t = await service.start('one', s.id, randomUUID(), wav());
    db.db.prepare("UPDATE turns SET status='processing' WHERE id=?").run(t.id);
    db.recover(); service = new HqVoiceService(db, deps);
    expect(db.turn(t.id)?.status).toBe('interrupted'); expect(service.jobs.size).toBe(0);
    expect(deps.main).not.toHaveBeenCalled(); expect(deps.submit).not.toHaveBeenCalled();
  });
  it('closing a session aborts generation and forbids retry', async () => {
    vi.mocked(deps.main).mockImplementation(({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('cancel', 'AbortError')), { once: true });
    }));
    const s = service.create('one', 'test'), t = await service.start('one', s.id, randomUUID(), Buffer.alloc(0), '取消');
    service.close(s.id, 'one');
    const result = await done(t.id, 'interrupted');
    expect(result.canRetryTts).toBe(false); expect(deps.tts).not.toHaveBeenCalled();
    await expect(service.start('one', s.id, randomUUID(), Buffer.alloc(0), '新一句')).rejects.toThrow('VOICE_SESSION_CLOSED');
  });
});
