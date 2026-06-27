// codex 验收抓到的两个 P1 回归 — 这两个测试如果绿，门就没开窗
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { mockAuthRoute } from '../routes/auth';
import { mockMeRoute } from '../routes/me';
import { hashPassword } from '../services/password';
import { getOrCreateUserByPhone, UserDeletedError, deleteAccount } from '../services/users';

function makeUser(extra?: Partial<{ phone: string; id: string; token: string }>) {
  const s = store.state();
  const id = extra?.id ?? 'usr_p1';
  const token = extra?.token ?? 'tok_p1';
  const phone = extra?.phone ?? '13700000001';
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

// ── P1 #1：已注销账号不能 OTP 复活 ───────────────────────────────────

describe('P1 #1: deleted account cannot be revived by OTP', () => {
  beforeEach(() => store.__resetForTests());

  it('service: getOrCreateUserByPhone throws UserDeletedError on a soft-deleted user', async () => {
    const { id, phone } = makeUser();
    await deleteAccount(id, { code: '123456' });
    expect(() => getOrCreateUserByPhone(phone)).toThrow(UserDeletedError);
  });

  it('service: anon user (passwordless + always available) is NEVER deleted, getOrCreate keeps working', () => {
    // 调匿名号本身不会因为别的 deletion 受影响
    const anon = getOrCreateUserByPhone('00000000000');
    expect(anon.id).toBeTruthy();
    expect(anon.deletedAt).toBeUndefined();
  });

  it('route: POST /api/auth/verify returns 410 ACCOUNT_DELETED for a soft-deleted phone', async () => {
    const { id, phone } = makeUser();
    await deleteAccount(id, { code: '123456' });

    const res = await mockAuthRoute.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code: '123456' }),
    });
    expect(res.status).toBe(410);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('ACCOUNT_DELETED');
  });

  it('route: same phone, NOT deleted → OTP verify still 200', async () => {
    const { phone } = makeUser();
    const res = await mockAuthRoute.request('/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, code: '123456' }),
    });
    expect(res.status).toBe(200);
  });
});

// ── P1 #2：stale token PATCH /profile 不能写匿名 ─────────────────────

describe('P1 #2: stale token PATCH /api/me/profile must NOT write to anon', () => {
  beforeEach(() => store.__resetForTests());

  it('stale token (version mismatch) → 401 AUTH_EXPIRED, anon row untouched', async () => {
    const { id, token } = makeUser();
    // 模拟密码改动 → tokenVersion bump
    store.state().users[id]!.tokenVersion = 5;
    // token 还是 'tok_p1'（旧版本，parseTokenVersion = 0）

    const res = await mockMeRoute.request('/profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nickname: '不能写到匿名号' }),
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('AUTH_EXPIRED');

    // 匿名号被 softAuth 创建但 nickname 必须没动
    const anonId = store.state().phoneIndex['00000000000'];
    if (anonId) {
      expect(store.state().users[anonId]!.nickname).toBeUndefined();
    }
    // 真正的 user 也没动
    expect(store.state().users[id]!.nickname).toBeUndefined();
  });

  it('no token at all → 401 AUTH_REQUIRED (anon never gets the patch)', async () => {
    const res = await mockMeRoute.request('/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nickname: '匿名也不能改' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json() as { code: string };
    expect(body.code).toBe('AUTH_REQUIRED');

    const anonId = store.state().phoneIndex['00000000000'];
    if (anonId) {
      expect(store.state().users[anonId]!.nickname).toBeUndefined();
    }
  });

  it('valid token → 200, profile written to the real user', async () => {
    const { id, token } = makeUser();
    const res = await mockMeRoute.request('/profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nickname: '正常路径' }),
    });
    expect(res.status).toBe(200);
    expect(store.state().users[id]!.nickname).toBe('正常路径');
  });

  it('deleted user with valid token → 401 AUTH_EXPIRED (deletedAt also gates)', async () => {
    const { id, token } = makeUser();
    await deleteAccount(id, { code: '123456' });

    const res = await mockMeRoute.request('/profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nickname: '注销后不能改' }),
    });
    expect(res.status).toBe(401);
  });
});

// ── P1 关联检查：PATCH /name 保留 softAuth（开门流契约），但行为可解释 ──

describe('PATCH /api/me/name: soft-auth path retained, documented behavior', () => {
  beforeEach(() => store.__resetForTests());

  it('no token → falls through to anon and writes name there (this is the open-flow contract)', async () => {
    const res = await mockMeRoute.request('/name', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '访客称呼' }),
    });
    expect(res.status).toBe(200);
    const anonId = store.state().phoneIndex['00000000000']!;
    expect(store.state().users[anonId]!.name).toBe('访客称呼');
    // 已知 trade-off：stale token 也会落到匿名号。Backlog 中记入「区分 no-token vs stale-token」。
  });
});
