// email-auth phase 回归套件 — 邮箱+密码注册/登录/绑定的路径与边界
//
// 覆盖：
// - register: 成功 / 重复 email / 弱密码 / 邮箱格式错
// - login: 成功 / 错密码 / 5 次锁定 / deletedAt
// - bind: 已登录改邮箱 / 首次绑定（需 password） / 唯一性冲突 / 大小写正规化
// - patchUserProfile 改 email 也走 emailIndex（保唯一性）
//
// 不依赖 phone 路径 —— 与现有 password.test.ts / account-mgmt.test.ts 互补
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER_BOUNDARY } from '@yelan/shared';
import { store } from '../store/persistence';
import { mockAuthRoute } from '../routes/auth';
import { mockMeRoute } from '../routes/me';
import { registerWithEmail, deleteAccount } from '../services/users';

describe('email-auth: POST /api/auth/email/register', () => {
  beforeEach(() => store.__resetForTests());

  it('200 + token + me with email & name', async () => {
    const res = await mockAuthRoute.request('/email/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'alice@example.com', password: 'Strong1pw', name: '阿璃' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string; me: { email: string; name: string; hasPassword: boolean; narrativeBoundary: number; phone?: string } };
    expect(body.token).toMatch(/^tok_v1_/);
    expect(body.me.email).toBe('alice@example.com');
    expect(body.me.name).toBe('阿璃');
    expect(body.me.hasPassword).toBe(true);
    expect(body.me.narrativeBoundary).toBe(DEFAULT_USER_BOUNDARY);
    expect(body.me.phone).toBeUndefined();
  });

  it('case-insensitive uniqueness: Foo@x.com == foo@x.com', async () => {
    await registerWithEmail('foo@x.com', 'Strong1pw');
    const res = await mockAuthRoute.request('/email/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'Foo@x.com', password: 'Strong1pw' }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('EMAIL_TAKEN');
  });

  it('400 PASSWORD_WEAK for short password', async () => {
    const res = await mockAuthRoute.request('/email/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@x.com', password: 'short' }),
    });
    // zod 长度先挡 (min 8) → 400
    expect(res.status).toBe(400);
  });

  it('400 for invalid email shape', async () => {
    const res = await mockAuthRoute.request('/email/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'not-an-email', password: 'Strong1pw' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('email-auth: POST /api/auth/email/login', () => {
  beforeEach(() => store.__resetForTests());

  it('200 + token; subsequent login refreshes token', async () => {
    const reg = await registerWithEmail('login@x.com', 'Strong1pw');
    const res = await mockAuthRoute.request('/email/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'login@x.com', password: 'Strong1pw' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    // 每次 login 都换 token —— 但版本号不变（这是 password login 的口径）
    expect(body.token).toMatch(/^tok_v1_/);
    expect(body.token).not.toBe(reg.token);
  });

  it('401 on wrong password', async () => {
    await registerWithEmail('wrong@x.com', 'Strong1pw');
    const res = await mockAuthRoute.request('/email/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'wrong@x.com', password: 'NopeNope1' }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe('PASSWORD_WRONG');
  });

  it('locks after 5 failed attempts → 423', async () => {
    await registerWithEmail('lock@x.com', 'Strong1pw');
    for (let i = 0; i < 5; i++) {
      const r = await mockAuthRoute.request('/email/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'lock@x.com', password: 'BadPass1' }),
      });
      expect(r.status).toBe(401);
    }
    // 第 6 次（即便密码对了）也被锁
    const res = await mockAuthRoute.request('/email/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'lock@x.com', password: 'Strong1pw' }),
    });
    expect(res.status).toBe(423);
    expect(((await res.json()) as { code: string }).code).toBe('ACCOUNT_LOCKED');
  });

  it('404 NOT_FOUND for soft-deleted user', async () => {
    const { user } = await registerWithEmail('gone@x.com', 'Strong1pw');
    await deleteAccount(user.id, { currentPassword: 'Strong1pw' });
    const res = await mockAuthRoute.request('/email/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'gone@x.com', password: 'Strong1pw' }),
    });
    expect(res.status).toBe(404);
  });

  it('normalizes email to lowercase before lookup', async () => {
    await registerWithEmail('CASE@x.com', 'Strong1pw');
    const res = await mockAuthRoute.request('/email/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'case@X.COM', password: 'Strong1pw' }),
    });
    expect(res.status).toBe(200);
  });
});

describe('email-auth: POST /api/me/email/bind', () => {
  beforeEach(() => store.__resetForTests());

  it('user with existing password can bind a fresh email (no password param)', async () => {
    const { user, token } = await registerWithEmail('orig@x.com', 'Strong1pw');
    // 改成新邮箱：注意 patch 后 emailIndex 旧值删，新值写
    const res = await mockMeRoute.request('/email/bind', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'new@x.com' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { me: { email: string }; token?: string };
    expect(body.me.email).toBe('new@x.com');
    expect(body.token).toBeUndefined(); // 没换密码就不发新 token
    expect(store.state().emailIndex['orig@x.com']).toBeUndefined();
    expect(store.state().emailIndex['new@x.com']).toBe(user.id);
  });

  it('409 EMAIL_TAKEN when binding to an email owned by another user', async () => {
    await registerWithEmail('taken@x.com', 'Strong1pw');
    const { token } = await registerWithEmail('mine@x.com', 'Strong1pw');
    const res = await mockMeRoute.request('/email/bind', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'taken@x.com' }),
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('EMAIL_TAKEN');
  });

  it('401 AUTH_REQUIRED without token', async () => {
    const res = await mockMeRoute.request('/email/bind', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'a@x.com', password: 'Strong1pw' }),
    });
    expect(res.status).toBe(401);
  });

  it('first-time bind requires password (passwordless OTP user)', async () => {
    // 模拟 OTP-only 老用户：phone 注册，没密码
    const s = store.state();
    const id = 'usr_otp_only';
    const token = 'tok_otp';
    s.users[id] = {
      id,
      phone: '13700000777',
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
    s.phoneIndex['13700000777'] = id;

    const res = await mockMeRoute.request('/email/bind', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      // 不传 password → 应被拒
      body: JSON.stringify({ email: 'late@x.com' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('NO_PASSWORD');

    // 传 password → 成功，返回新 token（tokenVersion bump）
    const res2 = await mockMeRoute.request('/email/bind', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'late@x.com', password: 'NewPass1pw' }),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { me: { email: string; hasPassword: boolean }; token?: string };
    expect(body2.me.email).toBe('late@x.com');
    expect(body2.me.hasPassword).toBe(true);
    expect(body2.token).toMatch(/^tok_v1_/);
  });

  it('does not reserve email when first-time bind fails password validation', async () => {
    const s = store.state();
    const id = 'usr_otp_weak_pw';
    const token = 'tok_otp_weak_pw';
    s.users[id] = {
      id,
      phone: '13700000888',
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
    s.phoneIndex['13700000888'] = id;

    const res = await mockMeRoute.request('/email/bind', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'weak@x.com', password: 'abcdefgh' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { code: string }).code).toBe('PASSWORD_WEAK');
    expect(store.state().emailIndex['weak@x.com']).toBeUndefined();
    expect(store.state().users[id]!.email).toBeUndefined();
  });
});

describe('email-auth: PATCH /api/me/profile email maintains emailIndex', () => {
  beforeEach(() => store.__resetForTests());

  it('changing email via profile updates emailIndex (and rejects collisions)', async () => {
    await registerWithEmail('owner@x.com', 'Strong1pw');
    const { user, token } = await registerWithEmail('me@x.com', 'Strong1pw');

    // 改成被占用的邮箱 → 409
    const r1 = await mockMeRoute.request('/profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'owner@x.com' }),
    });
    expect(r1.status).toBe(409);

    // 改成空 → 清掉 emailIndex 与 user.email
    const r2 = await mockMeRoute.request('/profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: null }),
    });
    expect(r2.status).toBe(200);
    expect(store.state().emailIndex['me@x.com']).toBeUndefined();
    expect(store.state().users[user.id]!.email).toBeUndefined();
  });
});
