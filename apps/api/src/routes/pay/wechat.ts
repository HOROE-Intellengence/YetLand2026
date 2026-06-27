import { Hono } from 'hono';
import { processMockPay, type MockPayBody } from './_helpers';

export const wechatRoute = new Hono();

wechatRoute.post('/callback', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as MockPayBody;
  const r = processMockPay('wechat', body);
  return c.json(r);
});
