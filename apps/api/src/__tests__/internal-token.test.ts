import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import { internalToken } from '../middleware/internal-token';
import { requestId } from '../middleware/request-id';

function makeApp() {
  const app = new Hono();
  app.use('*', requestId());
  app.use('/api/*', internalToken());
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/characters', (c) => c.json([{ id: 'c1', name: 'Test' }]));
  return app;
}

describe('internalToken middleware', () => {
  let originalRequired: string | undefined;
  let originalToken: string | undefined;

  beforeEach(() => {
    originalRequired = process.env.INTERNAL_TOKEN_REQUIRED;
    originalToken = process.env.INTERNAL_TOKEN;
    delete process.env.INTERNAL_TOKEN_REQUIRED;
    delete process.env.INTERNAL_TOKEN;
  });

  afterEach(() => {
    if (originalRequired === undefined) {
      delete process.env.INTERNAL_TOKEN_REQUIRED;
    } else {
      process.env.INTERNAL_TOKEN_REQUIRED = originalRequired;
    }
    if (originalToken === undefined) {
      delete process.env.INTERNAL_TOKEN;
    } else {
      process.env.INTERNAL_TOKEN = originalToken;
    }
  });

  it('passes when INTERNAL_TOKEN_REQUIRED is not set', async () => {
    const app = makeApp();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
  });

  it('passes when INTERNAL_TOKEN_REQUIRED=false', async () => {
    process.env.INTERNAL_TOKEN_REQUIRED = 'false';
    const app = makeApp();
    const res = await app.request('/api/health');
    expect(res.status).toBe(200);
  });

  it('returns 500 when REQUIRED=true but INTERNAL_TOKEN not configured', async () => {
    process.env.INTERNAL_TOKEN_REQUIRED = 'true';
    // INTERNAL_TOKEN intentionally unset
    const app = makeApp();
    const res = await app.request('/api/health');
    expect(res.status).toBe(500);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INTERNAL_TOKEN_NOT_CONFIGURED');
  });

  it('returns 401 when token header missing', async () => {
    process.env.INTERNAL_TOKEN_REQUIRED = 'true';
    process.env.INTERNAL_TOKEN = 'secret-abc123';
    const app = makeApp();
    const res = await app.request('/api/health');
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INTERNAL_TOKEN_MISSING');
  });

  it('returns 401 when token header is wrong', async () => {
    process.env.INTERNAL_TOKEN_REQUIRED = 'true';
    process.env.INTERNAL_TOKEN = 'secret-abc123';
    const app = makeApp();
    const res = await app.request('/api/health', {
      headers: { 'x-internal-token': 'wrong-token' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('INTERNAL_TOKEN_INVALID');
  });

  it('passes with correct token header', async () => {
    process.env.INTERNAL_TOKEN_REQUIRED = 'true';
    process.env.INTERNAL_TOKEN = 'secret-abc123';
    const app = makeApp();
    const res = await app.request('/api/health', {
      headers: { 'x-internal-token': 'secret-abc123' },
    });
    expect(res.status).toBe(200);
  });

  it('does not block /health when it is not under /api/*', async () => {
    // Create app where /health is NOT under /api/*
    const app = new Hono();
    app.use('*', requestId());
    app.use('/api/*', internalToken());
    app.get('/health', (c) => c.json({ ok: true }));

    process.env.INTERNAL_TOKEN_REQUIRED = 'true';
    process.env.INTERNAL_TOKEN = 'secret-abc123';

    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });
});
