import type { MiddlewareHandler } from 'hono';

export function withRequestId(): MiddlewareHandler {
  return async (c, next) => {
    const id = c.req.header('x-request-id') ?? crypto.randomUUID();
    c.set('requestId', id);
    c.header('x-request-id', id);
    await next();
  };
}
