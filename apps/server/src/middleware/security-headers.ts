import type { MiddlewareHandler } from 'hono';
import type { Env } from '../types/bindings';

export function securityHeaders(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    await next();

    c.res.headers.set(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https:;",
    );

    if (c.env.ENV === 'production') {
      c.res.headers.set(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload',
      );
    }

    c.res.headers.set('X-Frame-Options', 'DENY');
    c.res.headers.set('X-Content-Type-Options', 'nosniff');
    c.res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.res.headers.set('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
  };
}
