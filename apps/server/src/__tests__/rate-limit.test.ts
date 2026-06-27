import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types/bindings';
import { rateLimit } from '../middleware/rate-limit';
import { withErrorHandler } from '../middleware/error';

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
  app.use('*', withErrorHandler());
  app.use('/api/*', rateLimit());
  app.get('/api/health', (c) => c.json({ ok: true }));
  return app;
}

async function req(app: Hono<{ Bindings: Env }>, path: string, e: Env, init?: RequestInit) {
  return app.request(path, init, e);
}

describe('rateLimit', () => {
  it('passes through when RATE_LIMIT_KV is not bound', async () => {
    const e = env();
    const app = makeApp();
    const res = await req(app, '/api/health', e);
    expect(res.status).toBe(200);
  });

  it('does not apply rate limit to non-/api routes', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('*', withErrorHandler());
    app.use('/api/*', rateLimit());
    app.get('/health', (c) => c.json({ ok: true }));

    const e = env();
    const res = await app.request('/health', {}, e);
    expect(res.status).toBe(200);
  });
});
