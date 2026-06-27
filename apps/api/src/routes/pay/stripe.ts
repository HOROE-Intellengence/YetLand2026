import { Hono } from 'hono';
import { processMockPay, type MockPayBody } from './_helpers';

export const stripeRoute = new Hono();

stripeRoute.post('/webhook', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as MockPayBody;
  const r = processMockPay('stripe', body);
  return c.json(r);
});
