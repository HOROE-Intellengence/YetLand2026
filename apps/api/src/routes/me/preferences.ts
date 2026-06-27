// BE-103 — /api/me/preferences
// GET  获取当前用户 UI 偏好
// PUT  全量更新（幂等 upsert）
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { MePreferencesPutSchema } from '@yelan/shared';
import { requireAuth } from '../../middleware/auth';
import { uiPreferenceRepo } from '../../store/repositories';
import { validationHook } from '../../middleware/validation';

export const mockPreferencesRoute = new Hono();
mockPreferencesRoute.use('*', requireAuth());

mockPreferencesRoute.get('/', async (c) => {
  const userId = c.get('userId') as string;
  return c.json(await uiPreferenceRepo.get(userId));
});

mockPreferencesRoute.put('/', zValidator('json', MePreferencesPutSchema, validationHook), async (c) => {
  const userId = c.get('userId') as string;
  return c.json(await uiPreferenceRepo.upsert(userId, c.req.valid('json')));
});
