import { Hono } from 'hono';
import type { Env } from '../../types/bindings';

export const stripeRoute = new Hono<{ Bindings: Env }>();

// TODO: Stripe webhook 验签（stripe-signature）+ 幂等入账
stripeRoute.post('/webhook', async (c) => c.json({ ok: true }));
