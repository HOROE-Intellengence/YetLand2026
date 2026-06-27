import { Hono } from 'hono';
import { processMockPay, type MockPayBody } from './_helpers';

export const alipayRoute = new Hono();

alipayRoute.post('/callback', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as MockPayBody;
  const r = processMockPay('alipay', body);
  return c.json(r);
});
