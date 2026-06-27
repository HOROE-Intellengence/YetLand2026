// 成本看板（mock：基于 chat 路由累计的 costsDaily + 简易聚合）
import { Hono } from 'hono';
import { store } from '../../store/persistence';

export const adminCostsRoute = new Hono();

adminCostsRoute.get('/', (c) => {
  return c.json(store.state().costsDaily.sort((a, b) => (a.date < b.date ? -1 : 1)));
});

adminCostsRoute.get('/daily', (c) => {
  return c.json(store.state().costsDaily.sort((a, b) => (a.date < b.date ? -1 : 1)));
});

adminCostsRoute.get('/per-user', (c) => {
  // 按 conversationLogs / candleLedger 简化估算（mock 没有真精细 token 计量）
  const totals = new Map<string, { userId: string; calls: number; tokens: number }>();
  for (const r of store.state().conversationLogs) {
    const cur = totals.get(r.userId) ?? { userId: r.userId, calls: 0, tokens: 0 };
    cur.calls += 1;
    totals.set(r.userId, cur);
  }
  return c.json(Array.from(totals.values()));
});

adminCostsRoute.get('/cache-hit', (c) => {
  // mock 无真实 prompt cache；占位 0.6 让前端展示
  return c.json({ rate: null, reason: 'not_available_in_mock' });
});
