// Phase 4 — 改手机号 / 注销 / 登出全部设备
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { mockMeRoute } from '../routes/me';
import { hashPassword } from '../services/password';
import { changePhone, deleteAccount, AccountError, revokeAllSessions, parseTokenVersion } from '../services/users';

const ANON_PHONE = '00000000000';

function makeUser(extra?: Partial<{ phone: string; id: string; token: string }>) {
  const s = store.state();
  const id = extra?.id ?? 'usr_mg01';
  const token = extra?.token ?? 'tok_mg01';
  const phone = extra?.phone ?? '13900000010';
  s.users[id] = {
    id,
    phone,
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
  s.phoneIndex[phone] = id;
  return { id, token, phone };
}

describe('changePhone (service)', () => {
  beforeEach(() => store.__resetForTests());

  it('updates user.phone and phoneIndex atomically', async () => {
    const { id, phone } = makeUser();
    const u = await changePhone(id, '13911111111', '123456');
    expect(u.phone).toBe('13911111111');
    expect(u.phoneVerifiedAt).toBeTruthy();
    expect(store.state().phoneIndex[phone]).toBeUndefined();
    expect(store.state().phoneIndex['13911111111']).toBe(id);
  });

  it('refuses to bind to the anon phone', async () => {
    const { id } = makeUser();
    await expect(changePhone(id, ANON_PHONE, '123456')).rejects.toMatchObject({ code: 'ANON_PROTECTED' });
  });

  it('refuses to change the anon phone itself', async () => {
    const { id } = makeUser({ phone: ANON_PHONE });
    await expect(changePhone(id, '13911111111', '123456')).rejects.toMatchObject({ code: 'ANON_PROTECTED' });
  });

  it('rejects when target phone is taken by another user', async () => {
    const a = makeUser({ id: 'usr_a', token: 'tok_a', phone: '13911110001' });
    makeUser({ id: 'usr_b', token: 'tok_b', phone: '13911110002' });
    await expect(changePhone(a.id, '13911110002', '123456')).rejects.toMatchObject({ code: 'PHONE_TAKEN' });
  });
});

describe('deleteAccount (service)', () => {
  beforeEach(() => store.__resetForTests());

  it('soft-deletes by writing deletedAt and bumping tokenVersion', async () => {
    const { id } = makeUser();
    store.state().users[id]!.passwordHash = await hashPassword('Yelan2026');
    const u = await deleteAccount(id, { currentPassword: 'Yelan2026' });
    expect(u.deletedAt).toBeTruthy();
    expect(u.tokenVersion).toBeGreaterThan(0);
  });

  it('rejects without confirmation when user has password (no pw + no code → NEEDS_CONFIRMATION)', async () => {
    const { id } = makeUser();
    store.state().users[id]!.passwordHash = await hashPassword('Yelan2026');
    await expect(deleteAccount(id, {})).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION' });
  });

  it('accepts OTP code as confirmation even when password exists', async () => {
    const { id } = makeUser();
    store.state().users[id]!.passwordHash = await hashPassword('Yelan2026');
    const u = await deleteAccount(id, { code: '123456' });
    expect(u.deletedAt).toBeTruthy();
  });

  it('passwordless user must use OTP code', async () => {
    const { id } = makeUser();
    await expect(deleteAccount(id, {})).rejects.toMatchObject({ code: 'NEEDS_CONFIRMATION' });
    const u = await deleteAccount(id, { code: '123456' });
    expect(u.deletedAt).toBeTruthy();
  });

  it('wrong password without OTP fallback throws WRONG_PASSWORD', async () => {
    const { id } = makeUser();
    store.state().users[id]!.passwordHash = await hashPassword('Yelan2026');
    await expect(deleteAccount(id, { currentPassword: 'wrong' })).rejects.toMatchObject({ code: 'WRONG_PASSWORD' });
  });

  it('refuses to delete the anon user', async () => {
    const { id } = makeUser({ phone: ANON_PHONE });
    await expect(deleteAccount(id, { code: '123456' })).rejects.toMatchObject({ code: 'ANON_PROTECTED' });
  });

  it('is idempotent — second delete returns the already-deleted user', async () => {
    const { id } = makeUser();
    await deleteAccount(id, { code: '123456' });
    const u2 = await deleteAccount(id, { code: '123456' });
    expect(u2.deletedAt).toBeTruthy();
  });
});

describe('revokeAllSessions', () => {
  beforeEach(() => store.__resetForTests());

  it('issues a fresh versioned token; old token version is below current', () => {
    const { id, token } = makeUser();
    const oldVersion = parseTokenVersion(token); // 0 (legacy)
    const r = revokeAllSessions(id);
    expect(parseTokenVersion(r.token)).toBe(oldVersion + 1);
    expect(store.state().users[id]!.tokenVersion).toBe(oldVersion + 1);
  });
});

// ── route 层 ────────────────────────────────────────────────

describe('POST /api/me/phone/change (route)', () => {
  beforeEach(() => store.__resetForTests());

  it('returns 200 with updated Me on success', async () => {
    const { token } = makeUser();
    const res = await mockMeRoute.request('/phone/change', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPhone: '13922220001', code: '123456' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { phone: string; phoneVerifiedAt?: string };
    expect(body.phone).toBe('13922220001');
    expect(body.phoneVerifiedAt).toBeTruthy();
  });

  it('returns 409 PHONE_TAKEN when conflict', async () => {
    const a = makeUser({ id: 'usr_a', token: 'tok_a', phone: '13922220010' });
    makeUser({ id: 'usr_b', token: 'tok_b', phone: '13922220011' });
    const res = await mockMeRoute.request('/phone/change', {
      method: 'POST',
      headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPhone: '13922220011', code: '123456' }),
    });
    expect(res.status).toBe(409);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('PHONE_TAKEN');
  });

  it('returns 403 when attempting to bind anon phone', async () => {
    const { token } = makeUser();
    const res = await mockMeRoute.request('/phone/change', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPhone: ANON_PHONE, code: '123456' }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects without auth', async () => {
    const res = await mockMeRoute.request('/phone/change', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPhone: '13922220099', code: '123456' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/me/delete (route)', () => {
  beforeEach(() => store.__resetForTests());

  it('returns 200 and writes deletedAt', async () => {
    const { id, token } = makeUser();
    const res = await mockMeRoute.request('/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '123456' }),
    });
    expect(res.status).toBe(200);
    expect(store.state().users[id]!.deletedAt).toBeTruthy();
  });

  it('400 without any confirmation', async () => {
    const { token } = makeUser();
    const res = await mockMeRoute.request('/delete', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/me/sessions/revoke-all (route)', () => {
  beforeEach(() => store.__resetForTests());

  it('returns new token; old token then fails on requireAuth routes', async () => {
    const { token } = makeUser();
    const revokeRes = await mockMeRoute.request('/sessions/revoke-all', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(revokeRes.status).toBe(200);
    const body = await revokeRes.json() as { ok: boolean; token: string };
    expect(body.ok).toBe(true);
    expect(parseTokenVersion(body.token)).toBe(1);

    // 老 token 在 requireAuth 路由（phone/change）上失败
    const stale = await mockMeRoute.request('/phone/change', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPhone: '13911119999', code: '123456' }),
    });
    expect(stale.status).toBe(401);
  });
});
