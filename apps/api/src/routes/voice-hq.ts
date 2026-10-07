import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { HqSessionCreateSchema, HqTextInputSchema, VoiceRequestIdSchema } from '@yelan/shared';
import { requireAuth } from '../middleware/auth';
import { getDeployMode } from '../config/deploy-mode';
import { hqVoiceService, type HqVoiceService } from '../voice-hq/service';
import { MAX_UPLOAD_BYTES, MAX_OUTPUT_SECONDS, VoiceError } from '../voice/config';
import { readAudio, decodeAudio } from '../voice/audio';

export function createHqVoiceRoute(getService: () => HqVoiceService = hqVoiceService): Hono {
  const app = new Hono();
  app.use('*', requireAuth());
  app.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
  app.onError((e, c) => {
    const err = e instanceof VoiceError ? e : new VoiceError('HQ_INTERNAL_ERROR', 500);
    return c.json({ code: err.code }, err.status as 400 | 404 | 408 | 409 | 413 | 422 | 429 | 500 | 502 | 503);
  });
  app.get('/config', c => c.json({ localTest: getDeployMode() === 'local', replay: false }));
  app.post('/sessions', bodyLimit({ maxSize: 20000 }), async c => {
    const body = HqSessionCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) throw new VoiceError('VALIDATION_ERROR');
    return c.json(getService().create(c.get('userId') as string, body.data.characterId), 201);
  });
  app.get('/sessions/:id', c => c.json(getService().describe(c.req.param('id'), c.get('userId') as string)));
  app.get('/sessions/:id/turns', c => {
    const s = getService(); s.session(c.req.param('id'), c.get('userId') as string);
    return c.json({ turns: s.db.turns(c.req.param('id')).map(t => s.response(t)) });
  });
  app.get('/sessions/:id/turns/:turnId', c => {
    const s = getService(); return c.json(s.response(s.ownedTurn(c.req.param('id'), c.req.param('turnId'), c.get('userId') as string)));
  });
  app.post('/sessions/:id/turns/text', bodyLimit({ maxSize: 20000 }), async c => {
    if (getDeployMode() !== 'local') throw new VoiceError('HQ_LOCAL_TEXT_ONLY', 404);
    const body = HqTextInputSchema.safeParse(await c.req.json().catch(() => null));
    const key = VoiceRequestIdSchema.safeParse(c.req.header('Idempotency-Key'));
    if (!body.success || !key.success) throw new VoiceError('VALIDATION_ERROR');
    const response = await getService().start(c.get('userId') as string, c.req.param('id'), key.data, Buffer.alloc(0), body.data.text);
    return c.json(response, response.status === 'processing' ? 202 : 200);
  });
  let uploads = 0;
  const usersUploading = new Set<string>();
  app.post('/sessions/:id/turns', async c => {
    const key = VoiceRequestIdSchema.safeParse(c.req.header('Idempotency-Key'));
    if (!key.success) throw new VoiceError('VOICE_REQUEST_ID_REQUIRED');
    const userId = c.get('userId') as string, s = getService(); s.session(c.req.param('id'), userId);
    if (uploads >= 4 || usersUploading.has(userId)) throw new VoiceError('VOICE_UPLOAD_BUSY', 429);
    if (Number(c.req.header('Content-Length')) > MAX_UPLOAD_BYTES) throw new VoiceError('AUDIO_TOO_LARGE', 413);
    const reader = c.req.raw.body?.getReader(); if (!reader) throw new VoiceError('AUDIO_EMPTY', 422);
    uploads++; usersUploading.add(userId);
    let expired = false;
    const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 30000);
    try {
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (expired) throw new VoiceError('VOICE_UPLOAD_TIMEOUT', 408);
        if (done) break; size += value.length;
        if (size > MAX_UPLOAD_BYTES) { await reader.cancel(); throw new VoiceError('AUDIO_TOO_LARGE', 413); }
        chunks.push(value);
      }
      if (!size) throw new VoiceError('AUDIO_EMPTY', 422);
      const result = await s.start(userId, c.req.param('id'), key.data, Buffer.concat(chunks));
      return c.json(result, result.status === 'processing' ? 202 : 200);
    } finally { clearTimeout(timer); reader.releaseLock(); uploads--; usersUploading.delete(userId); }
  });
  app.post('/sessions/:id/turns/:turnId/retry-tts', c => {
    const key = VoiceRequestIdSchema.safeParse(c.req.header('Idempotency-Key'));
    if (!key.success) throw new VoiceError('VOICE_REQUEST_ID_REQUIRED');
    return c.json(getService().retry(c.get('userId') as string, c.req.param('id'), c.req.param('turnId'), key.data, 'tts'), 202);
  });
  app.post('/sessions/:id/turns/:turnId/resume-asr', c => {
    const key = VoiceRequestIdSchema.safeParse(c.req.header('Idempotency-Key'));
    if (!key.success) throw new VoiceError('VOICE_REQUEST_ID_REQUIRED');
    return c.json(getService().retry(c.get('userId') as string, c.req.param('id'), c.req.param('turnId'), key.data, 'asr'), 202);
  });
  app.get('/sessions/:id/turns/:turnId/audio', async c => {
    const s = getService(), t = s.ownedTurn(c.req.param('id'), c.req.param('turnId'), c.get('userId') as string);
    const asset = t.outputAssetId && s.db.asset(t.outputAssetId);
    if (!asset) throw new VoiceError('AUDIO_UNAVAILABLE', 404);
    const pcm = await decodeAudio(await readAudio(s.db, asset), 24000, MAX_OUTPUT_SECONDS);
    c.header('Content-Type', 'application/octet-stream');
    return c.body(new Uint8Array(pcm).buffer);
  });
  app.post('/sessions/:id/close', c => { getService().close(c.req.param('id'), c.get('userId') as string); return c.json({ ok: true }); });
  return app;
}
export const hqVoiceRoute = createHqVoiceRoute();
