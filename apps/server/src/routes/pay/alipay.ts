import { Hono } from 'hono';
import type { Env } from '../../types/bindings';

export const alipayRoute = new Hono<{ Bindings: Env }>();

// TODO: 支付宝异步通知验签 + 幂等入账
alipayRoute.post('/callback', async (c) => c.json({ ok: true }));
