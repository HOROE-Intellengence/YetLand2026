// Phase 3 — 密码登录 / 设置 / 重置 / tokenVersion 失效 / 锁定
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { mockAuthRoute } from '../routes/auth';
import { mockMeRoute } from '../routes/me';
import {
  setPassword,
  loginWithPassword,
  resetPasswordViaOtp,
  revokeAllSessions,
  parseTokenVersion,
  PasswordError,
} from '../services/users';
import { hashPassword } from '../services/password';

function makeUser(extra?: Partial<{ phone: string; id: string; token: string }>) {
  const s = store.state();
  const id = extra?.id ?? 'usr_pw01';
  const token = extra?.token ?? 'tok_pw01';
  const phone = extra?.phone ?? '13900000001';
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

describe('parseTokenVersion', () => {
  it('extracts version from versioned token', () => {
    expect(parseTokenVersion('tok_v3_abcdef')).toBe(3);
  });
  it('returns 0 for legacy tokens', () => {
    expect(parseTokenVersion('tok_abcdef')).toBe(0);
  });
});

describe('setPassword (service)', () => {
  beforeEach(() => store.__resetForTests());

  it('rejects weak passwords', async () => {
    const { id } = makeUser();
    await expect(setPassword(id, 'short')).rejects.toBeInstanceOf(PasswordError);
    await expect(setPassword(id, 'allletters')).rejects.toBeInstanceOf(PasswordError);
    await expect(setPassword(id, '12345678')).rejects.toBeInstanceOf(PasswordError);
  });

  it('sets the first password without requiring currentPassword', async () => {
    const { id } = makeUser();
    const r = await setPassword(id, 'Yelan2026');
    expect(r.user.passwordHash).toBeTruthy();
    expect(r.user.tokenVersion).toBe(1);
    expect(parseTokenVersion(r.token)).toBe(1);
  });

  it('requires currentPassword when one already exists', async () => {
    const { id } = makeUser();
    await setPassword(id, 'Yelan2026');
    await expect(setPassword(id, 'NewYelan2026')).rejects.toMatchObject({ code: 'WRONG' });
    await expect(setPassword(id, 'NewYelan2026', 'wrong')).rejects.toMatchObject({ code: 'WRONG' });
    const r = await setPassword(id, 'NewYelan2026', 'Yelan2026');
    expect(r.user.tokenVersion).toBe(2);
  });
});

describe('loginWithPassword (service)', () => {
  beforeEach(() => store.__resetForTests());

  it('returns user + new token on success', async () => {
    const { id, phone } = makeUser();
    await setPassword(id, 'Yelan2026');
    const r = await loginWithPassword(phone, 'Yelan2026');
    expect(r.user.id).toBe(id);
    expect(parseTokenVersion(r.token)).toBe(r.user.tokenVersion ?? 0);
  });

  it('locks after 5 failures', async () => {
    const { id, phone } = makeUser();
    await setPassword(id, 'Yelan2026');
    for (let i = 0; i < 5; i += 1) {
      await expect(loginWithPassword(phone, 'wrong')).rejects.toMatchObject({ code: 'WRONG' });
    }
    // 第 6 次 — 已锁定
    await expect(loginWithPassword(phone, 'Yelan2026')).rejects.toMatchObject({ code: 'LOCKED' });
  });

  it('rejects when user has no password set', async () => {
    const { phone } = makeUser();
    await expect(loginWithPassword(phone, 'anything12')).rejects.toMatchObject({ code: 'NO_PASSWORD' });
  });

  it('does not leak whether the phone exists (NOT_FOUND vs WRONG indistinguishable to caller)', async () => {
    await expect(loginWithPassword('13900099999', 'Yelan2026')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // 注：service 区分 NOT_FOUND vs WRONG，但 route 层映射成同样的 401 → 在 route 测里断言
  });
});

describe('resetPasswordViaOtp (service)', () => {
  beforeEach(() => store.__resetForTests());

  it('resets password and bumps tokenVersion', async () => {
    const { id, phone } = makeUser();
    await setPassword(id, 'Yelan2026');
    const v1 = store.state().users[id]!.tokenVersion;
    const r = await resetPasswordViaOtp(phone, '123456', 'NewYelan2026');
    expect(r.user.tokenVersion).toBeGreaterThan(v1 ?? 0);
    // 老密码失效
    await expect(loginWithPassword(phone, 'Yelan2026')).rejects.toMatchObject({ code: 'WRONG' });
    // 新密码可用
    const ok = await loginWithPassword(phone, 'NewYelan2026');
    expect(ok.user.id).toBe(id);
  });
});

describe('revokeAllSessions', () => {
  beforeEach(() => store.__resetForTests());

  it('bumps tokenVersion and old tokens become stale', () => {
    const { id, token } = makeUser();
    const oldVersion = store.state().users[id]!.tokenVersion ?? 0;
    expect(parseTokenVersion(token)).toBe(0);
    const r = revokeAllSessions(id);
    expect(store.state().users[id]!.tokenVersion).toBe(oldVersion + 1);
    expect(parseTokenVersion(r.token)).toBe(oldVersion + 1);
  });
});

describe('POST /api/auth/password/login (route)', () => {
  beforeEach(() => store.__resetForTests());

  it('returns 200 with token + me on success', async () => {
    const { id, phone } = makeUser();
    store.state().users[id]!.passwordHash = await hashPassword('Yelan2026');

    const res = await mockAuthRoute.request('/password/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password: 'Yelan2026' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { token: string; me: { id: string; hasPassword: boolean } };
    expect(body.me.id).toBe(id);
    expect(body.me.hasPassword).toBe(true);
  });

  it('returns 401 on wrong password', async () => {
    const { id, phone } = makeUser();
    store.state().users[id]!.passwordHash = await hashPassword('Yelan2026');

    const res = await mockAuthRoute.request('/password/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password: 'WrongPwd12' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('PASSWORD_WRONG');
  });

  it('returns 423 ACCOUNT_LOCKED after 5 failures', async () => {
    const { id, phone } = makeUser();
    store.state().users[id]!.passwordHash = await hashPassword('Yelan2026');

    for (let i = 0; i < 5; i += 1) {
      await mockAuthRoute.request('/password/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, password: 'wrong-x12' }),
      });
    }
    const res = await mockAuthRoute.request('/password/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, password: 'Yelan2026' }),
    });
    expect(res.status).toBe(423);
  });
});

describe('POST /api/me/password (route)', () => {
  beforeEach(() => store.__resetForTests());

  it('rejects without auth', async () => {
    const res = await mockMeRoute.request('/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword: 'Yelan2026' }),
    });
    expect(res.status).toBe(401);
  });

  it('sets password and returns new token; old token then fails auth', async () => {
    const { token } = makeUser();
    const setRes = await mockMeRoute.request('/password', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ newPassword: 'Yelan2026' }),
    });
    expect(setRes.status).toBe(200);
    const body = await setRes.json() as { token: string; me: { hasPassword: boolean } };
    expect(body.me.hasPassword).toBe(true);
    expect(parseTokenVersion(body.token)).toBe(1);

    // 旧 token 现在应该被中间件拒绝（走 requireAuth 的 /api/auth/me）
    // 注意：/api/me 走 softAuth → token 失效会降级到匿名号，仍返回 200（这是设计意图）
    const probeRes = await mockAuthRoute.request('/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(probeRes.status).toBe(401);
    const probeBody = await probeRes.json() as { code: string };
    expect(probeBody.code).toBe('AUTH_EXPIRED');

    // 新 token 可用
    const okRes = await mockAuthRoute.request('/me', {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(okRes.status).toBe(200);
  });
});

describe('softAuth degradation when token version stale', () => {
  beforeEach(() => store.__resetForTests());

  it('falls back to an isolated per-visitor guest instead of 401 (keeps openflow alive)', async () => {
    const { id, token } = makeUser();
    // 模拟密码改过 → version bump，旧 token 失效
    store.state().users[id]!.tokenVersion = 5;
    const res = await mockMeRoute.request('/', {
      headers: { Authorization: `Bearer ${token}`, 'X-Device-Id': 'dev_stale_probe' },
    });
    // 仍 200（开门流不中断），但降级到「该设备自己的游客行」而非共享匿名号
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; phone?: string };
    expect(body.id).not.toBe(id); // 不是原用户
    expect(body.phone).toBeUndefined(); // 游客行没有共享匿名号的 phone
    expect(body.id).toBe(store.state().deviceIndex['dev_stale_probe']);
    // 共享匿名号不再被 softAuth 创建
    expect(store.state().phoneIndex['00000000000']).toBeUndefined();
  });
});
