// BE-102 — /api/me/memories
// GET  ?since=        增量同步（拉取 >= since 的全部偏好+事件）
// POST                 批量 upsert（客户端 sync up）
// DELETE /:id          软删（tombstone）
// POST /recall         服务端 cosine top-K recall（降级用）
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { MeMemoriesUpsertSchema, MeMemoriesRecallSchema } from '@yelan/shared';
import { requireAuth } from '../../middleware/auth';
import { validationHook } from '../../middleware/validation';
import {
  listPreferences,
  upsertPreferences,
  deletePreference,
  deleteAllMemories,
  listEvents,
  upsertEvents,
  deleteEvent,
  recall,
  getMemoryProfile,
} from '../../services/memories';

export const mockMemoriesRoute = new Hono();
mockMemoriesRoute.use('*', requireAuth());

// ── 增量同步（下行） ──
mockMemoriesRoute.get('/', (c) => {
  const userId = c.get('userId') as string;
  const since = c.req.query('since') ?? undefined;
  return c.json({
    preferences: listPreferences(userId, since),
    events: listEvents(userId, since),
    profile: getMemoryProfile(userId),
  });
});

// ── 批量 upsert（上行） ──
mockMemoriesRoute.post('/', zValidator('json', MeMemoriesUpsertSchema, validationHook), (c) => {
  const userId = c.get('userId') as string;
  const body = c.req.valid('json');
  let prefs: (ReturnType<typeof upsertPreferences>[number] & { clientId?: number })[] = [];
  let evts: (ReturnType<typeof upsertEvents>[number] & { clientId?: number })[] = [];
  if (body.preferences?.length) {
    prefs = upsertPreferences(userId, body.preferences).map((r, i) => ({
      ...r,
      clientId: body.preferences![i]!.clientId,
    }));
  }
  if (body.events?.length) {
    evts = upsertEvents(userId, body.events).map((r, i) => ({
      ...r,
      clientId: body.events![i]!.clientId,
    }));
  }
  return c.json({ preferences: prefs, events: evts }, 201);
});

// ── 删除（软删 tombstone） ──
mockMemoriesRoute.delete('/', (c) => {
  const userId = c.get('userId') as string;
  const deleted = deleteAllMemories(userId);
  return c.json({ ok: true, deleted });
});

mockMemoriesRoute.delete('/:id', (c) => {
  const userId = c.get('userId') as string;
  const id = c.req.param('id');
  const ok = deletePreference(userId, id) || deleteEvent(userId, id);
  if (!ok) return c.json({ code: 'NOT_FOUND', message: 'memory not found' }, 404);
  return c.json({ ok: true });
});

// ── Recall（服务端降级） ──
mockMemoriesRoute.post('/recall', zValidator('json', MeMemoriesRecallSchema, validationHook), (c) => {
  const userId = c.get('userId') as string;
  const body = c.req.valid('json');
  const results = recall(userId, body.characterId, body.mode, body.embedding, body.topK ?? 5);
  return c.json({ results });
});
