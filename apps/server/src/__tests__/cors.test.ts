import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types/bindings';
import { withCors } from '../middleware/cors';

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
  app.use('*', withCors());
  app.get('/api/health', (c) => c.json({ ok: true }));
  return app;
}

async function req(app: Hono<{ Bindings: Env }>, path: string, e: Env, init?: RequestInit) {
  return app.request(path, init, e);
}

describe('withCors', () => {
  it('allows whitelisted origin', async () => {
    const e = env({ CORS_ORIGINS: 'https://app.example.com,https://admin.example.com' });
    const app = makeApp();
    const res = await req(app, '/api/health', e, {
      headers: { origin: 'https://app.example.com' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('https://app.example.com');
  });

  it('blocks non-whitelisted origin', async () => {
    const e = env({ CORS_ORIGINS: 'https://app.example.com' });
    const app = makeApp();
    const res = await req(app, '/api/health', e, {
      headers: { origin: 'https://attacker.com' },
    });
    const acao = res.headers.get('access-control-allow-origin');
    expect(acao === '' || acao === null).toBe(true);
  });

  it('reflects origin in development with empty whitelist', async () => {
    const e = env({ ENV: 'development' });
    const app = makeApp();
    const res = await req(app, '/api/health', e, {
      headers: { origin: 'http://localhost:5173' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
  });

  it('blocks in production with empty whitelist', async () => {
    const e = env({ ENV: 'production' });
    const app = makeApp();
    const res = await req(app, '/api/health', e, {
      headers: { origin: 'https://attacker.com' },
    });
    const acao = res.headers.get('access-control-allow-origin');
    expect(acao === '' || acao === null).toBe(true);
  });
});
