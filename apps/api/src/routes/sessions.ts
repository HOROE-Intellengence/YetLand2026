// 会话恢复 / 创建 / 历史消息
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import {
  RecentSessionResponseSchema,
  SessionCreateRequestSchema,
  SessionMessagesResponseSchema,
  SessionResponseSchema,
} from '@yelan/shared';
import { softAuth } from '../middleware/auth';
import { store, type SessionRow } from '../store/persistence';

export const mockSessionsRoute = new Hono();
mockSessionsRoute.use('*', softAuth());

mockSessionsRoute.get('/recent', (c) => {
  const userId = c.get('userId') as string;
  const sessions = Object.values(store.state().sessions)
    .filter((s) => s.userId === userId && !s.id.startsWith('hq_'))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return c.json(RecentSessionResponseSchema.parse(sessions[0] ?? null));
});

mockSessionsRoute.post('/', async (c) => {
  const userId = c.get('userId') as string;
  const parsed = SessionCreateRequestSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'VALIDATION_ERROR', issues: parsed.error.issues }, 400);
  }
  const body = parsed.data;
  const characterId = body.characterId ?? 'shen-yan-zhi';
  const mode: 'main' | 'if' = body.mode === 'if' ? 'if' : 'main';
  const id = `sess_${randomUUID().slice(0, 8)}`;
  const now = new Date().toISOString();
  const row: SessionRow = {
    id,
    userId,
    characterId,
    mode,
    ifActive: mode === 'if',
    round: 0,
    prevStage: 'daily',
    createdAt: now,
    updatedAt: now,
  };
  store.state().sessions[id] = row;
  store.save();
  return c.json(SessionResponseSchema.parse(row));
});

mockSessionsRoute.get('/:id/messages', (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId') as string;
  const sess = store.state().sessions[id];
  if (!sess || sess.userId !== userId) {
    return c.json({ code: 'NOT_FOUND', message: 'session not found' }, 404);
  }
  return c.json(SessionMessagesResponseSchema.parse(store.state().messages[id] ?? []));
});
