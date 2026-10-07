import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

describe('managed phone control-plane boundary', () => {
  afterEach(() => vi.unstubAllEnvs());
  it.each(['/api/auth/login', '/api/tool-proxy', '/api/push/deploy-personal', '/api/supabase-admin', '/api/yelan/config', '/world-builder', '/world-builder/nested', '/api/tripo/generate'])('disables retired route %s even in self-hosted mode', async path => {
    vi.stubEnv('YELAN_PHONE_MANAGED', 'true');
    vi.stubEnv('NEXT_PUBLIC_SELF_HOSTED_MODE', 'true');
    const response = await middleware(new NextRequest(`http://localhost:3001${path}`));
    expect(response.status).toBe(404);
  });
  it('lets the managed bridge perform its own server-side authorization', async () => {
    vi.stubEnv('YELAN_PHONE_MANAGED', 'true');
    const response = await middleware(new NextRequest('http://localhost:3001/api/host/phone/bootstrap'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
