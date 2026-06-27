// 请求级 requestId：接收 x-request-id 或生成新 id，响应 header 带 x-request-id
import type { MiddlewareHandler } from 'hono';
import { randomUUID } from 'node:crypto';

declare module 'hono' {
  interface ContextVariableMap {
    requestId: string;
  }
}

export const requestId = (): MiddlewareHandler => async (c, next) => {
  const id = c.req.header('x-request-id') || `req_${randomUUID().slice(0, 12)}`;
  c.set('requestId', id);
  c.res.headers.set('x-request-id', id);
  await next();
};
