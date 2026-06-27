import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types/bindings';
import { AppError } from './error';

const DEFAULT_LIMIT = 60;
const WINDOW_SECONDS = 60;

export function rateLimit(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    if (!c.env.RATE_LIMIT_KV) {
      return next();
    }

    const ip =
      c.req.header('cf-connecting-ip') ||
      c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const bucket = Math.floor(Date.now() / 1000 / WINDOW_SECONDS);
    const key = `rl:${ip}:${bucket}`;

    const current = Number((await c.env.RATE_LIMIT_KV.get(key)) ?? 0);
    if (current >= DEFAULT_LIMIT) {
      throw new AppError(429, 'RATE_LIMIT_EXCEEDED', `Too many requests (limit ${DEFAULT_LIMIT}/min)`);
    }

    await c.env.RATE_LIMIT_KV.put(key, String(current + 1), {
      expirationTtl: WINDOW_SECONDS * 2,
    });

    await next();
  };
}
