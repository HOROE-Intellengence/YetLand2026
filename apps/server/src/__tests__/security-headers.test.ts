import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types/bindings';
import { securityHeaders } from '../middleware/security-headers';

function env(overrides: Partial<Env> = {}): Env {
  return {
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    DEEPSEEK_API_KEY: '',
    UNLIM_WORKER_URL: '',
    DATABASE_URL: '',
    REDIS_URL: '',
    NARRATIVE_BOUNDARY_GLOBAL: '2',
    ADMIN_TOKEN: 'admin-test',
    INTERNAL_TOKEN: '',
    ...overrides,
  } as Env;
}

function makeApp() {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', securityHeaders());
  app.get('/api/health', (c) => c.json({ ok: true }));
  return app;
}

async function req(app: Hono<{ Bindings: Env }>, path: string, e: Env, init?: RequestInit) {
  return app.request(path, init, e);
}

describe('securityHeaders', () => {
  it('sets CSP header', async () => {
    const e = env();
    const res = await req(makeApp(), '/api/health', e);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('sets X-Frame-Options', async () => {
    const e = env();
    const res = await req(makeApp(), '/api/health', e);
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('sets X-Content-Type-Options', async () => {
    const e = env();
    const res = await req(makeApp(), '/api/health', e);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('sets Referrer-Policy', async () => {
    const e = env();
    const res = await req(makeApp(), '/api/health', e);
    expect(res.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
  });

  it('sets Permissions-Policy', async () => {
    const e = env();
    const res = await req(makeApp(), '/api/health', e);
    expect(res.headers.get('permissions-policy')).toContain('geolocation=()');
  });

  it('sets HSTS in production', async () => {
    const e = env({ ENV: 'production' });
    const res = await req(makeApp(), '/api/health', e);
    expect(res.headers.get('strict-transport-security')).toContain('max-age=31536000');
  });

  it('does not set HSTS in development', async () => {
    const e = env({ ENV: 'development' });
    const res = await req(makeApp(), '/api/health', e);
    expect(res.headers.get('strict-transport-security')).toBeNull();
  });
});
