import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types/bindings';

const getAllowedOrigins = (env: Env): string[] => {
  const raw = env.CORS_ORIGINS ?? '';
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
};

export function withCors(): MiddlewareHandler<{ Bindings: Env }> {
  return cors({
    origin: (origin, c) => {
      const allowed = getAllowedOrigins(c.env);
      if (allowed.length === 0) {
        return c.env.ENV === 'production' ? null : origin;
      }
      return allowed.includes(origin) ? origin : null;
    },
    credentials: true,
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Authorization', 'X-Admin-Token', 'Content-Type'],
  });
}
