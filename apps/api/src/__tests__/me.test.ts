import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { mockMeRoute } from '../routes/me';

function makeUser() {
  const s = store.state();
  const id = 'usr_name01';
  const token = 'tok_name01';
  s.users[id] = {
    id,
    phone: '13800000002',
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
  s.phoneIndex['13800000002'] = id;
  return { id, token };
}

describe('PATCH /api/me/name', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('updates user display name and mirrors it into the user profile', async () => {
    const { id, token } = makeUser();
    const res = await mockMeRoute.request('/name', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '  小夜  ' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; name: string };
    expect(body).toMatchObject({ id, name: '小夜' });
    expect(store.state().users[id]?.name).toBe('小夜');
    expect(store.state().userProfiles[id]?.markdown).toContain('- 用户称呼名：小夜');
  });

  it('rejects an empty display name', async () => {
    const { token } = makeUser();
    const res = await mockMeRoute.request('/name', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: '   ' }),
    });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/me/profile', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('writes email/nickname/avatarUrl/bio to user row and returns Me with new fields', async () => {
    const { id, token } = makeUser();
    const res = await mockMeRoute.request('/profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: 'someone@example.com',
        nickname: '夜阑',
        avatarUrl: 'https://cdn.example.com/avatar.png',
        bio: '走在夜里的人',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      id,
      email: 'someone@example.com',
      nickname: '夜阑',
      avatarUrl: 'https://cdn.example.com/avatar.png',
      bio: '走在夜里的人',
    });
    const u = store.state().users[id]!;
    expect(u.email).toBe('someone@example.com');
    expect(u.nickname).toBe('夜阑');
    expect(u.avatarUrl).toBe('https://cdn.example.com/avatar.png');
    expect(u.bio).toBe('走在夜里的人');
  });

  it('clears a field when null is sent', async () => {
    const { id, token } = makeUser();
    store.state().users[id]!.email = 'old@example.com';

    const res = await mockMeRoute.request('/profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: null }),
    });

    expect(res.status).toBe(200);
    expect(store.state().users[id]!.email).toBeUndefined();
  });

  it('does NOT pollute userProfiles markdown (sidecar channel is separate)', async () => {
    const { id, token } = makeUser();
    store.state().userProfiles[id] = { markdown: '- 用户称呼名：原称呼', updatedAt: 'x' };

    await mockMeRoute.request('/profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nickname: '别名' }),
    });

    expect(store.state().userProfiles[id]!.markdown).toBe('- 用户称呼名：原称呼');
    expect(store.state().users[id]!.nickname).toBe('别名');
  });

  it('rejects an invalid email format', async () => {
    const { token } = makeUser();
    const res = await mockMeRoute.request('/profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email: 'not-an-email' }),
    });

    expect(res.status).toBe(400);
  });

  it('rejects a bio longer than 280 chars', async () => {
    const { token } = makeUser();
    const res = await mockMeRoute.request('/profile', {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ bio: 'x'.repeat(281) }),
    });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/me', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('returns hasPassword=false for a fresh user without password', async () => {
    const { token } = makeUser();
    const res = await mockMeRoute.request('/', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { hasPassword: boolean };
    expect(body.hasPassword).toBe(false);
  });
});
