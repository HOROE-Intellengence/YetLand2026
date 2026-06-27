// auth 路由单测 — OTP、验证、/me
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER_BOUNDARY } from '@yelan/shared';
import { store } from '../store/persistence';
import { clearPolicyCache } from '../services/policy';
import { mockAuthRoute } from '../routes/auth';

function makeUser() {
  const s = store.state();
  const id = 'usr_test01';
  const token = 'tok_test01';
  s.users[id] = {
    id,
    phone: '13800000001',
    token,
    ageVerified: true,
    narrativeBoundary: 2,
    ifUnlocked: false,
    createdAt: new Date().toISOString(),
    candle: 100,
    registerGrant: 100,
    conversationRounds: 0,
  };
  s.tokenIndex[token] = id;
  s.phoneIndex['13800000001'] = id;
  store.save();
  return { id, token };
}

describe('POST /api/auth/otp', () => {
  beforeEach(() => {
    store.__resetForTests();
    clearPolicyCache();
  });

  it('returns 400 VALIDATION_ERROR on empty body', async () => {
    const res = await mockAuthRoute.request('/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with ok:true for valid phone', async () => {
    const res = await mockAuthRoute.request('/otp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '13800000001' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('POST /api/auth/verify', () => {
  beforeEach(() => {
    store.__resetForTests();
    clearPolicyCache();
  });

  it('returns 400 VALIDATION_ERROR on empty body', async () => {
    const res = await mockAuthRoute.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 with token and me for valid phone+code', async () => {
    const res = await mockAuthRoute.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '13800000001', code: '123456' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; me: { id: string; phone: string; narrativeBoundary: number } };
    expect(body.token).toBeTruthy();
    expect(body.me.id).toBeTruthy();
    expect(body.me.phone).toBe('13800000001');
    expect(body.me.narrativeBoundary).toBe(DEFAULT_USER_BOUNDARY);
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(() => {
    store.__resetForTests();
    clearPolicyCache();
  });

  it('returns 401 AUTH_REQUIRED without auth header', async () => {
    const res = await mockAuthRoute.request('/me');
    expect(res.status).toBe(401);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('AUTH_REQUIRED');
  });

  it('returns 401 AUTH_INVALID with wrong token', async () => {
    const res = await mockAuthRoute.request('/me', {
      headers: { Authorization: 'Bearer wrong-token' },
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('AUTH_INVALID');
  });

  it('returns 200 with me object for valid token', async () => {
    const { token } = makeUser();
    const res = await mockAuthRoute.request('/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; phone: string };
    expect(body.id).toBe('usr_test01');
    expect(body.phone).toBe('13800000001');
  });

  it('token from /verify works for /me', async () => {
    const verifyRes = await mockAuthRoute.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '13900000002', code: '654321' }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json() as { token: string; me: { id: string } };

    const meRes = await mockAuthRoute.request('/me', {
      headers: { Authorization: `Bearer ${verifyBody.token}` },
    });
    expect(meRes.status).toBe(200);
    const meBody = await meRes.json() as { id: string };
    expect(meBody.id).toBe(verifyBody.me.id);
  });
});
