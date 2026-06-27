import type { MiddlewareHandler } from 'hono';
import { logError } from '../services/error-logger';

export function internalToken(): MiddlewareHandler {
  return async (c, next) => {
    const required = process.env.INTERNAL_TOKEN_REQUIRED === 'true';
    const expected = process.env.INTERNAL_TOKEN;
    const received = c.req.header('x-internal-token');

    if (!required) {
      return next();
    }

    if (!expected) {
      logError({
        ts: new Date().toISOString(),
        requestId: (c.get('requestId') as string) || 'unknown',
        method: 'INTERNAL_TOKEN',
        path: c.req.path,
        status: 500,
        code: 'INTERNAL_TOKEN_NOT_CONFIGURED',
        message: 'INTERNAL_TOKEN_REQUIRED=true but INTERNAL_TOKEN not set',
      });
      return c.json({ code: 'INTERNAL_TOKEN_NOT_CONFIGURED' }, 500);
    }

    if (!received) {
      logError({
        ts: new Date().toISOString(),
        requestId: (c.get('requestId') as string) || 'unknown',
        method: 'INTERNAL_TOKEN',
        path: c.req.path,
        status: 401,
        code: 'INTERNAL_TOKEN_MISSING',
        message: 'X-Internal-Token header missing',
      });
      return c.json({ code: 'INTERNAL_TOKEN_MISSING' }, 401);
    }

    if (received !== expected) {
      logError({
        ts: new Date().toISOString(),
        requestId: (c.get('requestId') as string) || 'unknown',
        method: 'INTERNAL_TOKEN',
        path: c.req.path,
        status: 401,
        code: 'INTERNAL_TOKEN_INVALID',
        message: 'X-Internal-Token mismatch',
      });
      return c.json({ code: 'INTERNAL_TOKEN_INVALID' }, 401);
    }

    await next();
  };
}
