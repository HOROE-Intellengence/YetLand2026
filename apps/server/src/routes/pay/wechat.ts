import { Hono } from 'hono';
import type { Env } from '../../types/bindings';

export const wechatRoute = new Hono<{ Bindings: Env }>();

// TODO: 微信支付回调验签 + 幂等入账
wechatRoute.post('/callback', async (c) => c.json({ ok: true }));
