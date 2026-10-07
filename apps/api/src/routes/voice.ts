import { Hono } from 'hono';
import { VoiceRequestIdSchema, VoiceSessionCreateSchema, VoiceTextInputSchema } from '@yelan/shared';
import { bodyLimit } from 'hono/body-limit';
import { stream } from 'hono/streaming';
import { requireAuth } from '../middleware/auth';
import { MAX_UPLOAD_BYTES, VoiceError } from '../voice/config';
import { voiceService } from '../voice/service';
import type { VoiceService } from '../voice/service';
import { publicTurn } from '../voice/database';
import { readAudio } from '../voice/audio';

export function createVoiceRoute(getService: () => VoiceService = voiceService): Hono {
  const app = new Hono();
  let uploads = 0;
  const uploadingUsers = new Set<string>();
  app.use('*', requireAuth());
  app.onError((error, c) => {
    const err = error instanceof VoiceError ? error : new VoiceError('VOICE_INTERNAL_ERROR', 500);
    return c.json({ code: err.code }, err.status as 400 | 404 | 408 | 409 | 413 | 415 | 422 | 429 | 500 | 502 | 503 | 504);
  });
  app.post('/sessions', async (c) => {
    const parsed = VoiceSessionCreateSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ code: 'VALIDATION_ERROR' }, 400);
    const service = getService(); await service.ready;
    return c.json(service.create(c.get('userId') as string, parsed.data.characterId), 201);
  });
  app.get('/sessions/:id/turns', async (c) => {
    const service = getService(); await service.ready;
    service.session(c.req.param('id'), c.get('userId') as string);
    return c.json({ turns: service.db.turns(c.req.param('id')).map(publicTurn) });
  });
  app.get('/sessions/:id', async (c) => {
    const service = getService(); await service.ready;
    return c.json(service.session(c.req.param('id'), c.get('userId') as string));
  });
  app.get('/sessions/:id/turns/:turnId/audio-stream', async (c) => {
    const service = getService(); await service.ready;
    service.session(c.req.param('id'), c.get('userId') as string);
    const turn = service.db.turn(c.req.param('turnId'));
    if (!turn || turn.sessionId !== c.req.param('id')) return c.json({ code: 'VOICE_TURN_NOT_FOUND' }, 404);
    const raw = c.req.query('offset') ?? '0';
    const offset = Number(raw);
    if (!/^\d+$/.test(raw) || !Number.isSafeInteger(offset) || offset % 2 || offset > 180 * 48000) {
      return c.json({ code: 'INVALID_AUDIO_OFFSET' }, 400);
    }
    c.header('Content-Type', 'application/octet-stream'); // PCM16 LE, mono, 24 kHz
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Accel-Buffering', 'no');
    return stream(c, async (output) => {
      const controller = new AbortController();
      output.onAbort(() => controller.abort());
      try {
        for await (const chunk of service.streamAudio(turn.id, offset, controller.signal)) await output.write(chunk);
      } finally { controller.abort(); }
    });
  });
  app.get('/sessions/:id/turns/:turnId', async (c) => {
    const service = getService(); await service.ready;
    service.session(c.req.param('id'), c.get('userId') as string);
    const turn = service.db.turn(c.req.param('turnId'));
    if (!turn || turn.sessionId !== c.req.param('id')) return c.json({ code: 'VOICE_TURN_NOT_FOUND' }, 404);
    return c.json(publicTurn(turn));
  });
  app.post('/sessions/:id/turns', async (c) => {
    const userId = c.get('userId') as string;
    const requestId = VoiceRequestIdSchema.safeParse(c.req.header('Idempotency-Key'));
    if (!requestId.success) return c.json({ code: 'VOICE_REQUEST_ID_REQUIRED' }, 400);
    const service = getService(); await service.ready;
    if (uploads >= 4 || uploadingUsers.has(userId)) return c.json({ code: 'VOICE_UPLOAD_BUSY' }, 429);
    service.session(c.req.param('id'), userId);
    const mime = c.req.header('content-type')?.split(';')[0]?.trim().toLowerCase();
    if (!mime || !['audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/flac', 'video/webm'].includes(mime)) {
      return c.json({ code: 'AUDIO_FORMAT_UNSUPPORTED' }, 415);
    }
    if (Number(c.req.header('content-length')) > MAX_UPLOAD_BYTES) return c.json({ code: 'AUDIO_TOO_LARGE' }, 413);
    const reader = c.req.raw.body?.getReader();
    if (!reader) return c.json({ code: 'AUDIO_EMPTY' }, 422);
    uploads++; uploadingUsers.add(userId);
    let expired = false;
    const timer = setTimeout(() => { expired = true; void reader.cancel().catch(() => {}); }, 30_000);
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (expired) throw new VoiceError('VOICE_UPLOAD_TIMEOUT', 408);
        if (done) break;
        bytes += value.length;
        if (bytes > MAX_UPLOAD_BYTES) { await reader.cancel(); throw new VoiceError('AUDIO_TOO_LARGE', 413); }
        chunks.push(Buffer.from(value));
      }
      clearTimeout(timer);
      if (!bytes) throw new VoiceError('AUDIO_EMPTY', 422);
      const turn = await service.start(userId, c.req.param('id'), requestId.data, Buffer.concat(chunks));
      return c.json(publicTurn(turn), turn.status === 'processing' ? 202 : 200);
    } finally {
      clearTimeout(timer); reader.releaseLock(); uploads--; uploadingUsers.delete(userId);
    }
  });
  app.post('/sessions/:id/close', async (c) => {
    const service = getService(); await service.ready;
    service.closeSession(c.req.param('id'), c.get('userId') as string);
    return c.json({ ok: true });
  });
  app.post('/sessions/:id/turns/text', bodyLimit({ maxSize: 20_000 }), async (c) => {
    const requestId = VoiceRequestIdSchema.safeParse(c.req.header('Idempotency-Key'));
    const body = VoiceTextInputSchema.safeParse(await c.req.json().catch(() => null));
    if (!requestId.success || !body.success) return c.json({ code: 'VALIDATION_ERROR' }, 400);
    const turn = await getService().start(c.get('userId') as string, c.req.param('id'), requestId.data, Buffer.alloc(0), body.data.text);
    return c.json(publicTurn(turn), turn.status === 'processing' ? 202 : 200);
  });
  app.get('/assets/:assetId', async (c) => {
    const service = getService(); await service.ready;
    const asset = service.db.asset(c.req.param('assetId'));
    if (!asset || asset.userId !== c.get('userId')) return c.json({ code: 'VOICE_ASSET_NOT_FOUND' }, 404);
    const data = await readAudio(service.db, asset);
    const headers = new Headers({
      'Content-Type': 'audio/ogg; codecs=opus', 'Cache-Control': 'private, no-store',
      'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
    });
    const range = c.req.header('Range');
    let start = 0, end = data.length - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${data.length}` } });
      }
      if (!match[1]) start = Math.max(0, data.length - Number(match[2]));
      else { start = Number(match[1]); if (match[2]) end = Math.min(end, Number(match[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= data.length || start > end) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${data.length}` } });
      }
      headers.set('Content-Range', `bytes ${start}-${end}/${data.length}`);
    }
    headers.set('Content-Length', String(end - start + 1));
    return new Response(new Uint8Array(data.subarray(start, end + 1)), { status: range ? 206 : 200, headers });
  });
  return app;
}

export const voiceRoute = createVoiceRoute();
