// 侧袋 AI — /api/admin/sidecar-prompts
// GET                    列出全部 5 个 prompt（含当前值和默认值）
// PATCH /:key            更新单个 prompt（值 + reason，落审计）
// DELETE /:key           删除单个 override，回退代码默认值
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AdminSidecarPromptPatchSchema, SidecarPromptKeySchema } from '@yelan/shared';
import { store } from '../../store/persistence';
import { getAllPrompts, getDefaultPrompt } from '../../sidecar-ai/prompts';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminSidecarPromptsRoute = new Hono();

adminSidecarPromptsRoute.get('/', (c) => {
  const current = getAllPrompts();
  const prompts = (Object.keys(current) as Array<keyof typeof current>).map((key) => ({
    key,
    currentValue: current[key],
    defaultValue: getDefaultPrompt(key),
  }));
  return c.json({ prompts });
});

adminSidecarPromptsRoute.patch('/:key', zValidator('json', AdminSidecarPromptPatchSchema, validationHook), (c) => {
  const key = c.req.param('key');
  const parsed = SidecarPromptKeySchema.safeParse(key);
  if (!parsed.success) {
    return c.json({ code: 'INVALID_KEY', message: `unknown sidecar key: ${key}` }, 400);
  }

  const body = c.req.valid('json');
  const s = store.state();
  if (!s.sidecarPrompts) s.sidecarPrompts = {};
  s.sidecarPrompts[parsed.data] = body.value;
  store.save();

  audit('sidecar-prompts.update', key, body.reason, { value: body.value.slice(0, 100) });

  return c.json({ key: parsed.data, value: body.value });
});

adminSidecarPromptsRoute.delete('/:key', (c) => {
  const key = c.req.param('key');
  const parsed = SidecarPromptKeySchema.safeParse(key);
  if (!parsed.success) {
    return c.json({ code: 'INVALID_KEY', message: `unknown sidecar key: ${key}` }, 400);
  }

  const reason = c.req.query('reason') || 'reset sidecar prompt';
  const s = store.state();
  if (s.sidecarPrompts) delete s.sidecarPrompts[parsed.data];
  store.save();

  const defaultValue = getDefaultPrompt(parsed.data);
  audit('sidecar-prompts.reset', key, reason, { value: defaultValue.slice(0, 100) });

  return c.json({ key: parsed.data, value: defaultValue, reset: true });
});
