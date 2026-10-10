import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { VoiceDatabase } from './database';
import { VoiceService } from './service';
import { VoiceDiagnostics } from './diagnostics';
import type { LiveRequest } from './live';
import { VoiceError } from './config';
import { decodeAudio, readAudio } from './audio';
import { store } from '../store/persistence';
import { charactersService } from '../services/characters';
import { preludeCardsService, VOICE_PRELUDE_ID } from '../services/prelude-cards';
import { createAdminVoiceRoute } from '../routes/admin/voice';
import * as memory from '../phone/memory';

describe('admin voice connectivity and durable TTS diagnostics', () => {
  let root: string, db: VoiceDatabase, live: VoiceService, diagnostics: VoiceDiagnostics;
  let tts: ReturnType<typeof vi.fn>, generate: ReturnType<typeof vi.fn>;
  const headers = { Authorization: 'Bearer diagnostic-admin', 'Content-Type': 'application/json' };
  const input = (mode: 'instant' | 'advanced' = 'advanced') => ({
    mode,
    userId: 'one',
    characterId: 'builtin',
    text: '今晚的测试语音。',
    requestId: randomUUID(),
  });
  beforeEach(async () => {
    vi.stubEnv('ADMIN_TOKEN', 'diagnostic-admin');
    vi.stubEnv('DEPLOY_MODE', 'server');
    vi.stubEnv('VOICE_HQ_FISH_API_KEY', 'test-only');
    vi.stubEnv('VOICE_RELAY_URL', 'wss://test.example/google-live');
    vi.stubEnv('VOICE_RELAY_TOKEN', 'test-relay-token-00000000000000000000');
    store.__resetForTests();
    store.state().users.one = {
      id: 'one',
      token: 'token-one',
      ageVerified: true,
      narrativeBoundary: 2,
      ifUnlocked: false,
      createdAt: new Date().toISOString(),
      candle: 100,
      registerGrant: 100,
      conversationRounds: 0,
    };
    charactersService.upsert({
      id: 'builtin',
      slug: 'builtin',
      name: '测试角色',
      rarity: 'free',
      priceCandle: 0,
      boundaryDefault: 2,
      description: '测试设定',
    });
    preludeCardsService.upsert({
      id: VOICE_PRELUDE_ID,
      name: '语音前置',
      content: '测试专用前置',
      scope: 'voice',
    });
    root = await mkdtemp(join(tmpdir(), 'yl-voice-diag-'));
    db = new VoiceDatabase(root);
    tts = vi.fn(async () => Buffer.alloc(9600, 1));
    generate = vi.fn(async (request: LiveRequest) => {
      const progress = {
        inputText: request.text!,
        outputText: '真实路径测试回复',
        inputTranscriptComplete: true,
        outputTranscriptComplete: true,
        usage: null,
      };
      request.onAudio(Buffer.alloc(9600, 1));
      request.onProgress(progress);
      return progress;
    });
    live = new VoiceService(db, generate);
    diagnostics = new VoiceDiagnostics(db, () => live, tts);
    vi.spyOn(memory, 'rememberVoiceTurn');
  });
  afterEach(async () => {
    await vi.waitFor(
      () => {
        expect(live.jobs.size).toBe(0);
        expect(diagnostics.jobs.size).toBe(0);
      },
      { timeout: 10000 },
    );
    db.close();
    if (!resolve(root).startsWith(resolve(join(tmpdir(), 'yl-voice-diag-'))))
      throw new Error('Unexpected cleanup path');
    await rm(root, { recursive: true, force: true });
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });
  async function done(id: string, status = 'complete') {
    await vi.waitFor(async () => expect((await diagnostics.result(id)).status).toBe(status), {
      timeout: 10000,
    });
    return diagnostics.result(id);
  }
  it('runs direct Fish TTS in server mode, stores exact text, valid Opus and checksum metadata', async () => {
    const value = input();
    const first = await diagnostics.start(value),
      result = await done(first.id);
    expect(result).toMatchObject({
      mode: 'advanced',
      kind: 'fish_tts',
      inputText: value.text,
      outputText: value.text,
      persistence: { turnSaved: true, audioSaved: true, audioReadable: true },
    });
    expect(tts).toHaveBeenCalledTimes(1);
    expect(tts.mock.calls[0]?.[0]).toBe(value.text);
    expect(generate).not.toHaveBeenCalled();
    expect(memory.rememberVoiceTurn).not.toHaveBeenCalled();
    const turn = db.turn(result.turnId!)!,
      asset = db.asset(result.outputAudio!.id)!;
    expect(turn.trainingConsent).toBe(0);
    expect(db.isHqSession(result.id)).toBe(true);
    expect(await decodeAudio(await readAudio(db, asset), 24000)).toHaveLength(9600);
    const app = createAdminVoiceRoute(
      () => db,
      () => diagnostics,
    );
    const audio = await app.request(`/assets/${asset.id}`, { headers });
    expect(audio.status).toBe(200);
    expect(audio.headers.get('Content-Type')).toContain('audio/ogg');
    const listing = (await (await app.request('/sessions', { headers })).json()) as {
      rows: { id: string; diagnostic: number; turnCount: number }[];
    };
    expect(listing.rows[0]).toMatchObject({
      id: result.id,
      diagnostic: 1,
      turnCount: 1,
    });
  });
  it('runs the original Gemini Live service and storage while excluding test speech from role memories', async () => {
    const first = await diagnostics.start(input('instant')),
      result = await done(first.id);
    expect(result).toMatchObject({
      kind: 'live_reply',
      outputText: '真实路径测试回复',
      persistence: { turnSaved: true, audioSaved: true, audioReadable: true },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(tts).not.toHaveBeenCalled();
    expect(memory.rememberVoiceTurn).not.toHaveBeenCalled();
    expect(db.isHqSession(result.id)).toBe(false);
    expect(db.turn(result.turnId!)?.model).toBe('gemini-3.8-live');
  });
  it('requires admin authentication on both creating and polling tests before accessing storage', async () => {
    const getter = vi.fn(() => diagnostics),
      app = createAdminVoiceRoute(() => db, getter);
    for (const auth of [{}, { Authorization: 'Bearer token-one' }] as Record<string, string>[]) {
      expect(
        (
          await app.request('/tests', {
            method: 'POST',
            headers: auth,
            body: JSON.stringify(input()),
          })
        ).status,
      ).toBe(401);
      expect((await app.request('/tests/missing', { headers: auth })).status).toBe(401);
    }
    expect(getter).not.toHaveBeenCalled();
    expect(
      (
        await app.request('/tests', {
          method: 'POST',
          headers,
          body: JSON.stringify({ text: 'bad' }),
        })
      ).status,
    ).toBe(400);
    expect(tts).not.toHaveBeenCalled();
  });
  it('consumes one paid request, recovers original results after restart and rejects conflicting retries', async () => {
    const value = input(),
      first = await diagnostics.start(value);
    await done(first.id);
    expect((await diagnostics.start(value)).id).toBe(first.id);
    await expect(diagnostics.start({ ...value, text: '不同文字' })).rejects.toThrow(
      'VOICE_IDEMPOTENCY_CONFLICT',
    );
    db.close();
    db = new VoiceDatabase(root);
    db.recover();
    live = new VoiceService(db, generate);
    diagnostics = new VoiceDiagnostics(db, () => live, tts);
    expect(await diagnostics.start(value)).toMatchObject({
      id: first.id,
      status: 'complete',
      persistence: { audioReadable: true },
    });
    expect(tts).toHaveBeenCalledTimes(1);
  });
  it('retains upstream errors and does not synthesize again when the same request is repeated', async () => {
    tts.mockRejectedValueOnce(new VoiceError('HQ_FISH_HTTP_401', 502));
    const value = input(),
      first = await diagnostics.start(value),
      result = await done(first.id, 'failed');
    expect(result).toMatchObject({
      errorCode: 'HQ_FISH_HTTP_401',
      persistence: { turnSaved: true, audioSaved: false, audioReadable: false },
    });
    expect((await diagnostics.start(value)).status).toBe('failed');
    expect(tts).toHaveBeenCalledTimes(1);
    await expect(diagnostics.start({ ...input(), userId: 'unknown' })).rejects.toThrow(
      'REGISTERED_ACCOUNT_REQUIRED',
    );
    await expect(diagnostics.start({ ...input(), characterId: 'unknown' })).rejects.toThrow(
      'CHARACTER_NOT_FOUND',
    );
  });
  it('fails the storage check when a completed audio file is corrupted', async () => {
    const first = await diagnostics.start(input()),
      result = await done(first.id);
    const asset = db.asset(result.outputAudio!.id)!;
    await writeFile(join(root, 'assets', asset.filename), 'corrupted');
    expect(await diagnostics.result(first.id)).toMatchObject({
      status: 'failed',
      errorCode: 'AUDIO_STORAGE_CHECK_FAILED',
      persistence: { audioSaved: true, audioReadable: false },
    });
    const app = createAdminVoiceRoute(
      () => db,
      () => diagnostics,
    );
    expect((await app.request(`/assets/${asset.id}`, { headers })).status).toBe(410);
  });
});
