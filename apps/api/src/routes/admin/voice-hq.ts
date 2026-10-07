import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { FishSlotWriteSchema, FishPreviewSchema, HqVoiceProfileIdSchema, FishCatalogQuerySchema } from '@yelan/shared';
import { requireAdmin } from '../../middleware/auth';
import { voiceDatabase, type VoiceDatabase } from '../../voice/database';
import { encodeOpus } from '../../voice/audio';
import { VoiceError } from '../../voice/config';
import { settings, saveSlot } from '../../voice-hq/profiles';
import { listFishVoices, synthesize, FISH_TTS_MODEL } from '../../voice-hq/providers';
import { audit } from './_audit';

export function createAdminHqVoiceRoute(getDb: () => VoiceDatabase = voiceDatabase,
  providers = { list: listFishVoices, tts: synthesize }) {
  const app = new Hono(); let previewBusy = false;
  app.use('*', requireAdmin());
  app.use('*', bodyLimit({ maxSize: 20000 }));
  app.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
  app.onError((e, c) => {
    const code = e instanceof VoiceError ? e.code : 'HQ_FISH_UNAVAILABLE';
    const message = code === 'HQ_TTS_NOT_CONFIGURED' ? 'Fish API key 尚未配置' :
      code.includes('HTTP_401') ? 'Fish 鉴权失败，请检查后端密钥' : code.includes('HTTP_402') ? 'Fish 账户额度不足' :
      code.includes('HTTP_429') ? 'Fish 请求过于频繁，请稍后再试' :
      code === 'HQ_VOICE_UNAVAILABLE' ? '音色已停用或不存在' : '音色操作失败，请检查配置或稍后重试';
    return c.json({ code, message }, (e instanceof VoiceError ? e.status : 502) as 400 | 404 | 409 | 429 | 502 | 503);
  });
  app.get('/', c => c.json(settings(getDb())));
  app.get('/catalog', async c => {
    const input = FishCatalogQuerySchema.safeParse(c.req.query());
    if (!input.success) return c.json({ message: '搜索条件无效' }, 400);
    return c.json(await providers.list({ ...input.data, self: input.data.self === 'true' }, c.req.raw.signal));
  });
  app.put('/slots/:category', async c => {
    const category = HqVoiceProfileIdSchema.safeParse(c.req.param('category'));
    const input = FishSlotWriteSchema.safeParse(await c.req.json().catch(() => null));
    if (!category.success || !input.success) return c.json({ message: '分类绑定无效' }, 400);
    saveSlot(getDb(), category.data, input.data.referenceId, input.data.speed);
    audit('voice-hq.configure', category.data, input.data.reason, { referenceId: input.data.referenceId, speed: input.data.speed });
    return c.json(settings(getDb()));
  });
  app.post('/preview', async c => {
    const input = FishPreviewSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) return c.json({ message: '试听文本须为 1–300 字，语速须为 0.5–1.5' }, 400);
    if (previewBusy) return c.json({ message: '正在试听生成，请等待当前请求完成' }, 429);
    previewBusy = true;
    try {
      const pcm = await providers.tts(input.data.text, { id: 'young-female', label: '后台试听', voiceName: 'Fish 试听',
        model: FISH_TTS_MODEL, provider: 'fish', style: '', revision: 1, referenceId: input.data.referenceId,
        speed: input.data.speed, libraryId: null }, c.req.raw.signal);
      const audio = await encodeOpus(pcm, 24000, 48000);
      c.header('Content-Type', 'audio/ogg'); return c.body(new Uint8Array(audio).buffer);
    } finally { previewBusy = false; }
  });
  return app;
}
export const adminHqVoiceRoute = createAdminHqVoiceRoute();
