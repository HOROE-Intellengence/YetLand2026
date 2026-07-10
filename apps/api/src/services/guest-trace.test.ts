// feat/guest-trace — 游客留痕 + 注册原地转正
// 直接进入（跳过注册）按设备 id 建独立游客行；注册/首次 OTP 原地升级同一行。
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import {
  getOrCreateGuestByDevice,
  getOrCreateUserByPhone,
  registerWithEmail,
  getUserById,
  listUsers,
  patchUserName,
  patchUserProfile,
} from './users';

const DEVICE_A = 'dev_aaaa1111';
const DEVICE_B = 'dev_bbbb2222';

describe('guest trace: 按设备 id 建独立游客行', () => {
  beforeEach(() => store.__resetForTests());

  it('每台设备一条独立游客行，同设备复用', () => {
    const g1 = getOrCreateGuestByDevice(DEVICE_A);
    const g1again = getOrCreateGuestByDevice(DEVICE_A);
    const g2 = getOrCreateGuestByDevice(DEVICE_B);

    expect(g1.id).toBe(g1again.id); // 同设备复用
    expect(g1.id).not.toBe(g2.id); // 不同设备独立
    expect(g1.isGuest).toBe(true);
    expect(g1.deviceId).toBe(DEVICE_A);
  });

  it('游客名形如「游客xxxxx」，且建号不发 register grant', () => {
    const g = getOrCreateGuestByDevice(DEVICE_A);
    expect(g.name).toMatch(/^游客.{1,5}$/);
    expect(g.candle).toBe(0);
    expect(g.registerGrant).toBe(0);
    // 无烛账记录
    expect(store.state().candleLedger.filter((r) => r.userId === g.id)).toHaveLength(0);
  });

  it('deviceIndex 建立映射', () => {
    const g = getOrCreateGuestByDevice(DEVICE_A);
    expect(store.state().deviceIndex[DEVICE_A]).toBe(g.id);
  });
});

describe('guest trace: 注册/OTP 原地转正', () => {
  beforeEach(() => store.__resetForTests());

  it('邮箱注册在同一 userId 上升级游客行，会话零迁移', async () => {
    const guest = getOrCreateGuestByDevice(DEVICE_A);
    const guestId = guest.id;
    // 模拟游客留下一条会话
    store.state().sessions['sess_1'] = {
      id: 'sess_1',
      userId: guestId,
      characterId: 'char_1',
      mode: 'main',
      round: 1,
      prevStage: 'daily',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const { user } = await registerWithEmail('a@b.com', 'passw0rd', '小明', DEVICE_A);

    expect(user.id).toBe(guestId); // 同一行
    expect(user.email).toBe('a@b.com');
    expect(user.name).toBe('小明'); // 游客名被真实 name 覆盖
    expect(user.isGuest).toBeUndefined();
    expect(user.deviceId).toBeUndefined();
    // 会话仍挂在同一 userId
    expect(store.state().sessions['sess_1']!.userId).toBe(guestId);
    // 转正才发 register grant
    expect(user.registerGrant).toBeGreaterThan(0);
    expect(user.candle).toBeGreaterThan(0);
    // deviceIndex 已摘除
    expect(store.state().deviceIndex[DEVICE_A]).toBeUndefined();
  });

  it('首次 OTP（新手机号）原地升级游客行', () => {
    const guest = getOrCreateGuestByDevice(DEVICE_A);
    const user = getOrCreateUserByPhone('13700000009', DEVICE_A);
    expect(user.id).toBe(guest.id);
    expect(user.phone).toBe('13700000009');
    expect(user.isGuest).toBeUndefined();
    expect(user.candle).toBeGreaterThan(0);
  });

  it('无设备头时不误升级：注册新建独立账户', async () => {
    const guest = getOrCreateGuestByDevice(DEVICE_A);
    const { user } = await registerWithEmail('c@d.com', 'passw0rd');
    expect(user.id).not.toBe(guest.id);
    // 游客行原样保留
    expect(getUserById(guest.id)!.isGuest).toBe(true);
  });

  it('已注销的游客行不被复用（重新建号）', () => {
    const guest = getOrCreateGuestByDevice(DEVICE_A);
    guest.deletedAt = new Date().toISOString();
    const fresh = getOrCreateGuestByDevice(DEVICE_A);
    expect(fresh.id).not.toBe(guest.id);
  });

  it('后台可枚举到游客行', () => {
    getOrCreateGuestByDevice(DEVICE_A);
    getOrCreateGuestByDevice(DEVICE_B);
    const guests = listUsers().filter((u) => u.isGuest);
    expect(guests).toHaveLength(2);
  });
});

// ── 共享匿名号护栏：个人字段绝不写入 phone=00000000000 的共享号 ──
describe('shared-anon guard: 个人字段不污染共享匿名号', () => {
  beforeEach(() => store.__resetForTests());

  it('patchUserName 命中共享匿名号 → 名字不写入（原样返回）', () => {
    const anon = getOrCreateUserByPhone('00000000000');
    expect(anon.name).toBeUndefined();
    const out = patchUserName(anon.id, '时月');
    expect(out).not.toBeNull();
    expect(getUserById(anon.id)!.name).toBeUndefined();
    // userProfiles 也不该被种入个人称呼名
    expect(store.state().userProfiles[anon.id]).toBeUndefined();
  });

  it('patchUserProfile 命中共享匿名号 → email/nickname 不写入', () => {
    const anon = getOrCreateUserByPhone('00000000000');
    patchUserProfile(anon.id, { nickname: '不该出现', email: 'x@y.com' });
    const after = getUserById(anon.id)!;
    expect(after.nickname).toBeUndefined();
    expect(after.email).toBeUndefined();
  });

  it('普通游客行不受护栏影响，正常写名字', () => {
    const g = getOrCreateGuestByDevice(DEVICE_A);
    patchUserName(g.id, '真实访客');
    expect(getUserById(g.id)!.name).toBe('真实访客');
  });
});
