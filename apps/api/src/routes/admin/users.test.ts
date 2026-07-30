import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_USER_BOUNDARY } from '@yelan/shared';
import { store, type PersistedUser } from '../../store/persistence';
import { adminUsersRoute } from './users';

// 回归：曾经后端默认 limit=100 + 前端固定 limit=200，配合 listUsers() 的插入序
// （旧→新），slice(0,200) 会恰好丢弃「最新注册」的用户 → 可视化后台看不到新增。
// 现在：缺省全量、最新在前，limit 只截断最旧的那批。

function seedUser(i: number): void {
  const id = `usr_${String(i).padStart(4, '0')}`;
  const u: PersistedUser = {
    id,
    token: `tok_${id}`,
    // createdAt 严格递增 → i 越大越新（base + i 秒）
    createdAt: new Date(Date.UTC(2026, 0, 1) + i * 1000).toISOString(),
    ageVerified: false,
    narrativeBoundary: DEFAULT_USER_BOUNDARY,
    ifUnlocked: false,
    candle: 0,
    registerGrant: 0,
    conversationRounds: 0,
    isGuest: i % 2 === 0,
  };
  store.state().users[id] = u;
}

describe('admin users route', () => {
  beforeEach(() => {
    store.__resetForTests();
    for (let i = 0; i < 234; i++) seedUser(i);
  });

  it('缺省返回全量用户，不再被 200 截断', async () => {
    const res = await adminUsersRoute.request('/');
    const rows = await res.json() as { id: string }[];
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(234);
  });

  it('最新注册的用户排在最前（新增用户可见）', async () => {
    const res = await adminUsersRoute.request('/');
    const rows = await res.json() as { id: string }[];
    // 最大 index = 233 → createdAt 最新
    expect(rows[0]?.id).toBe('usr_0233');
  });

  it('传 limit 时保留的是最新的用户，而非最旧的', async () => {
    const res = await adminUsersRoute.request('/?limit=10');
    const rows = await res.json() as { id: string }[];
    expect(rows).toHaveLength(10);
    expect(rows[0]?.id).toBe('usr_0233');
    expect(rows.some((r) => r.id === 'usr_0000')).toBe(false);
  });

  it('guest 过滤仍生效', async () => {
    const res = await adminUsersRoute.request('/?guest=0');
    const rows = await res.json() as { isGuest?: boolean }[];
    expect(rows.every((r) => !r.isGuest)).toBe(true);
    expect(rows).toHaveLength(117); // 奇数 index 117 个
  });
});
