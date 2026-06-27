import type { MiddlewareHandler } from 'hono';

export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public extra?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function withErrorHandler(): MiddlewareHandler {
  return async (c, next) => {
    try {
      await next();
    } catch (e) {
      if (e instanceof AppError) {
        return c.json(
          { code: e.code, message: e.message, extra: e.extra ?? null },
          e.status as 500,
        );
      }
      console.error('[unhandled]', e);
      return c.json({ code: 'INTERNAL', message: 'internal error' }, 500);
    }
  };
}
