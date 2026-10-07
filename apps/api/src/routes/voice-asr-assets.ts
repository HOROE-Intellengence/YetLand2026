import { Hono } from 'hono';
import { getDeployMode } from '../config/deploy-mode';
import { requireAuth } from '../middleware/auth';
import { createAsrAudioLink, verifyAsrAudioLink } from '../voice/asr-signing';
import { readAudio } from '../voice/audio';
import { VoiceError } from '../voice/config';
import { voiceDatabase, type VoiceDatabase } from '../voice/database';

/** 独立于 voiceRoute 的登录中间件：阿里拉取仅凭限时签名，签发仍要求本人登录。 */
export function createVoiceAsrAssetsRoute(getDb: () => VoiceDatabase = voiceDatabase): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.header('Cache-Control', 'private, no-store');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Content-Type-Options', 'nosniff');
    await next();
  });
  app.onError((error, c) => {
    const err = error instanceof VoiceError ? error : new VoiceError('VOICE_ASR_ASSET_UNAVAILABLE', 500);
    return c.json({ code: err.code }, err.status as 400 | 403 | 404 | 500 | 503);
  });
  app.post('/:assetId/sign', requireAuth(), async c => {
    const db = getDb(), asset = db.asset(c.req.param('assetId'));
    const userId = c.get('userId') as string;
    if (!asset || asset.userId !== userId || asset.direction !== 'input') {
      return c.json({ code: 'VOICE_ASSET_NOT_FOUND' }, 404);
    }
    return c.json(createAsrAudioLink(asset, userId));
  });
  app.on(['GET', 'HEAD'], '/:assetId', async c => {
    // 本地既不签发也不提供免登录音频下载，不能作为公网签名测试通过的依据。
    if (getDeployMode() !== 'server') return c.json({ code: 'VOICE_ASSET_NOT_FOUND' }, 404);
    const db = getDb(), asset = db.asset(c.req.param('assetId'));
    if (!asset || asset.direction !== 'input') return c.json({ code: 'VOICE_ASSET_NOT_FOUND' }, 404);
    if (!verifyAsrAudioLink(asset, new URL(c.req.url).searchParams)) {
      return c.json({ code: 'VOICE_ASR_SIGNATURE_INVALID' }, 403);
    }
    const data = await readAudio(db, asset);
    let start = 0, end = data.length - 1;
    const range = c.req.header('Range');
    c.header('Accept-Ranges', 'bytes');
    if (range) {
      const m = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!m || (!m[1] && !m[2])) {
        c.header('Content-Range', `bytes */${data.length}`); return c.body(null, 416);
      }
      if (!m[1]) start = Math.max(0, data.length - Number(m[2]));
      else { start = Number(m[1]); if (m[2]) end = Math.min(end, Number(m[2])); }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= data.length || end < start) {
        c.header('Content-Range', `bytes */${data.length}`); return c.body(null, 416);
      }
      c.header('Content-Range', `bytes ${start}-${end}/${data.length}`);
    }
    c.header('Content-Type', 'audio/ogg; codecs=opus');
    c.header('Content-Length', String(end - start + 1));
    if (c.req.method === 'HEAD') return c.body(null, range ? 206 : 200);
    return c.body(new Uint8Array(data.subarray(start, end + 1)).buffer, range ? 206 : 200);
  });
  return app;
}

export const voiceAsrAssetsRoute = createVoiceAsrAssetsRoute();
