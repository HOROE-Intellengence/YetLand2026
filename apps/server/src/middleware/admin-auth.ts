import type { MiddlewareHandler } from 'hono';
import { AppError } from './error';
import type { Env } from '../types/bindings';

export function requireAdmin(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const token = c.req.header('x-admin-token');
    if (!token) {
      throw new AppError(401, 'ADMIN_AUTH_REQUIRED', 'admin token required');
    }
    if (token !== c.env.ADMIN_TOKEN) {
      throw new AppError(401, 'ADMIN_AUTH_INVALID', 'admin token invalid');
    }
    await next();
  };
}
