import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import type { Env } from '../types/bindings';
import { requireAdmin } from '../middleware/admin-auth';

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

describe('requireAdmin', () => {
  it('rejects requests without x-admin-token', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/admin/*', requireAdmin());
    app.get('/admin/users', (c) => c.json([]));

    const e = env({ ADMIN_TOKEN: 'secret' });
    const res = await app.request('/admin/users', {}, e);
    expect(res.ok).toBe(false);
  });

  it('rejects wrong x-admin-token', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/admin/*', requireAdmin());
    app.get('/admin/users', (c) => c.json([]));

    const e = env({ ADMIN_TOKEN: 'secret' });
    const res = await app.request('/admin/users', {
      headers: { 'x-admin-token': 'wrong' },
    }, e);
    expect(res.ok).toBe(false);
  });

  it('passes with correct x-admin-token', async () => {
    const app = new Hono<{ Bindings: Env }>();
    app.use('/admin/*', requireAdmin());
    app.get('/admin/users', (c) => c.json([]));

    const e = env({ ADMIN_TOKEN: 'secret' });
    const res = await app.request('/admin/users', {
      headers: { 'x-admin-token': 'secret' },
    }, e);
    expect(res.status).toBe(200);
  });
});
