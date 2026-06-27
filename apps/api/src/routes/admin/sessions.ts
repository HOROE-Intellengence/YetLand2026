// 会话查询（调试） — 列出 + 看消息
import { Hono } from 'hono';
import { store } from '../../store/persistence';

export const adminSessionsRoute = new Hono();

adminSessionsRoute.get('/', (c) => {
  const userId = c.req.query('userId');
  let rows = Object.values(store.state().sessions);
  if (userId) rows = rows.filter((r) => r.userId === userId);
  rows = rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return c.json(rows.slice(0, 200));
});

adminSessionsRoute.get('/:id/messages', (c) => {
  const id = c.req.param('id');
  return c.json(store.state().messages[id] ?? []);
});
