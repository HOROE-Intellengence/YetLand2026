// 用户域 — 创建用户 / 按 token 查 / 按 phone 查 / 烛账增减
import { mockOtpForTestsOnly, SMS_UNAVAILABLE_MESSAGE } from './sms-placeholder';
// 注：本文件是 apps/api 本地/当前 Docker 路线用，不替代未来 Workers 生产 services/auth
import { randomUUID } from 'node:crypto';
import { DEFAULT_USER_BOUNDARY } from '@yelan/shared';
import { store, type PersistedUser, type QuotaRow } from '../store/persistence';
import { policyService } from './policy';
import { hashPassword, verifyPassword, isStrongPassword } from './password';
import { hasActiveMembershipRow, refreshExpiredMembershipRows } from './membership-status';

// 密码登录失败锁定参数
const MAX_FAILED_LOGINS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 分钟

// 共享匿名号手机号 —— 与 middleware/auth.ts、下方 ANON_PHONE_GUARD 保持一致。
// softAuth 改造后新访客不再落到它，但历史遗留的 usr_f044c211 仍是这个号；
// 个人字段（name/画像）绝不能写到共享号上，否则会跨匿名访客串味。
const SHARED_ANON_PHONE = '00000000000';

/** 该 user 是否共享匿名号（phone === 共享匿名号）。个人字段写入前用它挡一道。 */
function isSharedAnon(u: PersistedUser): boolean {
  return u.phone === SHARED_ANON_PHONE;
}

/** 解析 token 中嵌入的版本号。形如 `tok_v3_xxxx` → 3；旧格式 `tok_xxx` → 0（向后兼容）。 */
export function parseTokenVersion(token: string): number {
  const m = token.match(/^tok_v(\d+)_/);
  return m ? Number(m[1]) : 0;
}

/** 生成新 token，嵌入版本号。版本号来自 user.tokenVersion（默认 0）。 */
function issueToken(version: number): string {
  return `tok_v${version}_${randomUUID().replace(/-/g, '')}`;
}

export function currentQuotaDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export function nextQuotaRefreshAt(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1)).toISOString();
}

function defaultFreeLimit(): number {
  return store.state().freeLimitOverride ?? policyService.get<number>('DAILY_FREE_ROUND_LIMIT', 20);
}

function ensureQuotaRow(userId: string, date = currentQuotaDate()): QuotaRow {
  const s = store.state();
  s.quota[userId] ??= {};
  s.quota[userId][date] ??= { date, freeUsed: 0, bonusUsed: 0, bonusLimit: 0 };
  return s.quota[userId][date];
}

function effectiveFreeLimit(row: QuotaRow): number {
  return row.freeLimit ?? defaultFreeLimit();
}

/**
 * 已注销账号被命中查找时抛出。route 层映射为 410 GONE。
 * 不混进 PasswordError/AccountError —— 那两个有自己的语义聚类。
 */
export class UserDeletedError extends Error {
  constructor(public phone: string) {
    super('account is deleted');
  }
}

/**
 * 按设备 id 找一条「可转正」的游客行（存在、isGuest、未注销）。
 * 用于注册/首次 OTP 时把游客行原地升级为真实账户 —— 会话/额度零迁移。
 */
function findConvertibleGuestByDevice(deviceId?: string): PersistedUser | null {
  if (!deviceId) return null;
  const s = store.state();
  const id = s.deviceIndex[deviceId];
  if (!id) return null;
  const u = s.users[id];
  if (!u || !u.isGuest || u.deletedAt) return null;
  return u;
}

/** 转正时发放注册烛火（游客建号时未发），并记账。 */
function grantRegisterCandle(u: PersistedUser, grant: number, now: string): void {
  u.candle += grant;
  u.registerGrant = grant;
  store.state().candleLedger.push({
    id: `cl_${randomUUID().slice(0, 8)}`,
    userId: u.id,
    delta: grant,
    reason: 'register_grant',
    refId: u.id,
    createdAt: now,
  });
}

/** 摘掉游客标记：清 isGuest/deviceId 并从 deviceIndex 删映射（登出后该设备重新拿到新游客号）。 */
function deGuest(u: PersistedUser): void {
  const s = store.state();
  if (u.deviceId) delete s.deviceIndex[u.deviceId];
  delete u.isGuest;
  delete u.deviceId;
}

export function getOrCreateUserByPhone(phone: string, guestDeviceId?: string): PersistedUser {
  const s = store.state();
  const existingId = s.phoneIndex[phone];
  if (existingId) {
    const existing = s.users[existingId]!;
    // 已注销账号不能通过 OTP 复活，否则 deleteAccount 形同虚设。
    // phoneIndex 不清理 —— 防止旧号被误绑到新账户。
    if (existing.deletedAt) throw new UserDeletedError(phone);
    return existing;
  }

  const grant = policyService.get<number>('REGISTER_CANDLE_GRANT', 100);
  const now = new Date().toISOString();

  // 游客转正：原地把游客行升级为真实手机号账户，会话/额度全部保留。
  const guest = findConvertibleGuestByDevice(guestDeviceId);
  if (guest) {
    guest.phone = phone;
    guest.registrationIdentity = { name: guest.name, phone, registeredAt: now };
    deGuest(guest);
    grantRegisterCandle(guest, grant, now);
    s.phoneIndex[phone] = guest.id;
    store.save();
    return guest;
  }

  const id = `usr_${randomUUID().slice(0, 8)}`;
  const token = `tok_${randomUUID().replace(/-/g, '')}`;
  const user: PersistedUser = {
    id,
    phone,
    registrationIdentity: { phone, registeredAt: now },
    token,
    ageVerified: false,
    narrativeBoundary: DEFAULT_USER_BOUNDARY,
    ifUnlocked: false,
    createdAt: now,
    candle: grant,
    registerGrant: grant,
    conversationRounds: 0,
  };
  s.users[id] = user;
  s.tokenIndex[token] = id;
  s.phoneIndex[phone] = id;
  s.candleLedger.push({
    id: `cl_${randomUUID().slice(0, 8)}`,
    userId: id,
    delta: grant,
    reason: 'register_grant',
    refId: id,
    createdAt: user.createdAt,
  });
  store.save();
  return user;
}

/**
 * 按设备 id 查/建游客行。直接进入（跳过注册）的访客走这里，
 * 每台设备一条独立 user 行 → 后台可见「游客xxxxx」+ 其会话/额度。
 * 注意：游客建号不发 register grant —— 转正（注册/登录）时才发放，防止刷设备薅烛。
 */
export function getOrCreateGuestByDevice(deviceId: string): PersistedUser {
  const s = store.state();
  const existingId = s.deviceIndex[deviceId];
  if (existingId) {
    const existing = s.users[existingId];
    if (existing && !existing.deletedAt) return existing;
  }

  const id = `usr_${randomUUID().slice(0, 8)}`;
  const token = `tok_${randomUUID().replace(/-/g, '')}`;
  // 展示名：游客 + 设备 id 尾段（去掉 dev_ 前缀后取末 5 位），便于后台辨认
  const suffix = deviceId.replace(/^dev_/, '').replace(/-/g, '').slice(-5) || randomUUID().slice(0, 5);
  const user: PersistedUser = {
    id,
    token,
    isGuest: true,
    deviceId,
    name: `游客${suffix}`,
    ageVerified: false,
    narrativeBoundary: DEFAULT_USER_BOUNDARY,
    ifUnlocked: false,
    createdAt: new Date().toISOString(),
    candle: 0,
    registerGrant: 0,
    conversationRounds: 0,
  };
  s.users[id] = user;
  s.tokenIndex[token] = id;
  s.deviceIndex[deviceId] = id;
  store.save();
  return user;
}

export function getUserByToken(token: string): PersistedUser | null {
  const s = store.state();
  const id = s.tokenIndex[token];
  return id ? s.users[id] ?? null : null;
}

export function getUserById(id: string): PersistedUser | null {
  return store.state().users[id] ?? null;
}

export function listUsers(): PersistedUser[] {
  return Object.values(store.state().users);
}

export function patchUserName(id: string, name: string): PersistedUser | null {
  const s = store.state();
  const u = s.users[id];
  if (!u) return null;
  // 护栏：绝不把个人称呼名/画像写到共享匿名号上（会跨访客串味）。
  // 正常路径下 softAuth 已不再产出共享号；这里是 stale-token 等边角的最后一道防线。
  if (isSharedAnon(u)) return u;
  const cleanName = name.trim();
  u.name = cleanName;

  const existing = s.userProfiles[id]?.markdown ?? '';
  const lines = existing
    .split('\n')
    .filter((line) => !line.startsWith('- 用户称呼名：') && !line.startsWith('- User display name:'));
  const markdown = [`- 用户称呼名：${cleanName}`, ...lines].join('\n').trim();
  s.userProfiles[id] = { markdown, updatedAt: new Date().toISOString() };

  store.save();
  return u;
}

export function patchUserFlags(
  id: string,
  patch: Partial<Pick<PersistedUser, 'ifUnlocked' | 'narrativeBoundary' | 'ageVerified'>>,
): PersistedUser | null {
  const s = store.state();
  const u = s.users[id];
  if (!u) return null;
  Object.assign(u, patch);
  store.save();
  return u;
}

/**
 * 更新用户账户档案字段（email/nickname/avatarUrl/bio）。
 * 注意：故意不写 userProfiles —— 那是 sidecar AI 的 LLM 上下文，
 * patchUserName 通过 userProfiles 注入「用户称呼名」是 chat pipeline 的契约（[chat.ts:95]）。
 * 本函数只动 user 行字段，零侧效应。
 * 传 null 表示清空字段；undefined 表示不动。
 */
export function patchUserProfile(
  id: string,
  patch: {
    email?: string | null;
    nickname?: string | null;
    avatarUrl?: string | null;
    bio?: string | null;
  },
): PersistedUser | null {
  const s = store.state();
  const u = s.users[id];
  if (!u) return null;
  // 护栏：共享匿名号不接受个人档案写入（email/nickname/avatar/bio）。
  // profile 路由本就走 requireAuth 不该命中共享号，这里与 patchUserName 对齐兜底。
  if (isSharedAnon(u)) return u;
  if (patch.email !== undefined) {
    const v = patch.email?.trim().toLowerCase() || '';
    if (!v) {
      if (u.email) delete s.emailIndex[u.email.toLowerCase()];
      delete u.email;
    } else {
      const existing = s.emailIndex[v];
      if (existing && existing !== id) {
        throw new EmailAuthError('EMAIL_TAKEN', '该邮箱已被注册');
      }
      if (u.email && u.email.toLowerCase() !== v) {
        delete s.emailIndex[u.email.toLowerCase()];
      }
      s.emailIndex[v] = id;
      u.email = v;
    }
  }
  if (patch.nickname !== undefined) {
    const v = patch.nickname?.trim();
    if (!v) delete u.nickname;
    else u.nickname = v;
  }
  if (patch.avatarUrl !== undefined) {
    const v = patch.avatarUrl?.trim();
    if (!v) delete u.avatarUrl;
    else u.avatarUrl = v;
  }
  if (patch.bio !== undefined) {
    const v = patch.bio?.trim();
    if (!v) delete u.bio;
    else u.bio = v;
  }
  store.save();
  return u;
}

// ── 账户安全（Phase 3）──────────────────────────────────────

export class PasswordError extends Error {
  constructor(public code: 'WEAK' | 'WRONG' | 'LOCKED' | 'NO_PASSWORD' | 'NOT_FOUND', message: string) {
    super(message);
  }
}

/**
 * 设置或修改当前用户密码。
 * - 首次设置：currentPassword 可不传
 * - 修改：必须传 currentPassword，且验证通过
 * 成功后 bump tokenVersion 并返回新 token（旧 token 全失效）。
 */
export async function setPassword(
  userId: string,
  newPassword: string,
  currentPassword?: string,
): Promise<{ user: PersistedUser; token: string }> {
  const s = store.state();
  const u = s.users[userId];
  if (!u) throw new PasswordError('NOT_FOUND', 'user not found');
  if (u.deletedAt) throw new PasswordError('NOT_FOUND', 'user deleted');
  if (!isStrongPassword(newPassword)) {
    throw new PasswordError('WEAK', '密码至少 8 位，需包含字母与数字');
  }
  // 已有密码 → 必须验证旧密码
  if (u.passwordHash) {
    if (!currentPassword) throw new PasswordError('WRONG', '请提供当前密码');
    const ok = await verifyPassword(currentPassword, u.passwordHash);
    if (!ok) throw new PasswordError('WRONG', '当前密码不正确');
  }
  u.passwordHash = await hashPassword(newPassword);
  u.passwordUpdatedAt = new Date().toISOString();
  u.failedLoginCount = 0;
  delete u.lockedUntil;
  // bump token version → 旧 token 全部失效（middleware 通过 parseTokenVersion 拦）
  // 注意：不删除旧 tokenIndex 映射 —— 留着才能让 middleware 报 AUTH_EXPIRED 而非 AUTH_INVALID
  // 已知 trade-off：tokenIndex 累积旧条目。Backlog: 周期性 GC。
  const nextVersion = (u.tokenVersion ?? 0) + 1;
  u.tokenVersion = nextVersion;
  const newToken = issueToken(nextVersion);
  s.tokenIndex[newToken] = u.id;
  u.token = newToken;
  store.save();
  return { user: u, token: newToken };
}

/**
 * 密码登录。返回新 token（每次登录都换 token 是一种简单的「正在使用最新会话」标记）。
 * 失败计数与锁定：连续失败 5 次 → 锁 15 分钟。
 */
export async function loginWithPassword(
  phone: string,
  plain: string,
): Promise<{ user: PersistedUser; token: string }> {
  const s = store.state();
  const id = s.phoneIndex[phone];
  if (!id) throw new PasswordError('NOT_FOUND', '账号或密码不正确');
  const u = s.users[id];
  if (!u) throw new PasswordError('NOT_FOUND', '账号或密码不正确');
  if (u.deletedAt) throw new PasswordError('NOT_FOUND', '账号或密码不正确');
  if (!u.passwordHash) throw new PasswordError('NO_PASSWORD', '此账号尚未设置密码');
  // 锁定检查
  if (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) {
    throw new PasswordError('LOCKED', '账号已锁定，请稍后再试');
  }
  const ok = await verifyPassword(plain, u.passwordHash);
  if (!ok) {
    u.failedLoginCount = (u.failedLoginCount ?? 0) + 1;
    if (u.failedLoginCount >= MAX_FAILED_LOGINS) {
      u.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
    }
    store.save();
    throw new PasswordError('WRONG', '账号或密码不正确');
  }
  // 成功：重置计数、issue 新 token（保留旧映射，让 middleware 通过 version 处理失效）
  u.failedLoginCount = 0;
  delete u.lockedUntil;
  const newToken = issueToken(u.tokenVersion ?? 0);
  s.tokenIndex[newToken] = u.id;
  u.token = newToken;
  store.save();
  return { user: u, token: newToken };
}

// ── 邮箱登录（email-auth phase）─────────────────────────────────
//
// 设计要点：
// - user.id 仍是 surrogate `usr_xxx`；email 是 login 标识，emailIndex 保唯一性
// - 邮箱统一小写 + trim，emailIndex 以小写为 key
// - phone 在 email-only 注册用户上 undefined，UI 优先展示 email
// - 拒绝 deleted email 复用注册（保持注销账户口径）
// - 密码规则复用 isStrongPassword，错码复用 PasswordError 体系
//
// 错码：
//   EmailAuthError { EMAIL_TAKEN } —— 注册或绑定时占用
//   PasswordError  { WEAK, WRONG, LOCKED, NO_PASSWORD, NOT_FOUND } —— 与现有 login 一致

export class EmailAuthError extends Error {
  constructor(public code: 'EMAIL_TAKEN' | 'NOT_FOUND', message: string) {
    super(message);
  }
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/**
 * 邮箱 + 密码注册。返回 token（v1）。
 * 唯一性：emailIndex 已有任意条目（含 deleted 用户）→ EMAIL_TAKEN。
 */
export async function registerWithEmail(
  emailRaw: string,
  password: string,
  name?: string,
  guestDeviceId?: string,
): Promise<{ user: PersistedUser; token: string }> {
  const s = store.state();
  const email = normalizeEmail(emailRaw);
  if (s.emailIndex[email]) {
    throw new EmailAuthError('EMAIL_TAKEN', '该邮箱已被注册');
  }
  if (!isStrongPassword(password)) {
    throw new PasswordError('WEAK', '密码至少 8 位，需包含字母与数字');
  }
  const grant = policyService.get<number>('REGISTER_CANDLE_GRANT', 100);
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);

  // 游客转正：原地升级游客行为邮箱账户，会话/额度全部保留，游客名被真实 name 覆盖。
  const guest = findConvertibleGuestByDevice(guestDeviceId);
  if (guest) {
    guest.email = email;
    if (name?.trim()) guest.name = name.trim();
    guest.registrationIdentity = { name: guest.name, email, registeredAt: now };
    guest.passwordHash = passwordHash;
    guest.passwordUpdatedAt = now;
    // bump 到 v1，与新注册用户一致（游客行原 token 无版本号，登录后换新版 token）
    guest.tokenVersion = 1;
    const newToken = issueToken(1);
    deGuest(guest);
    grantRegisterCandle(guest, grant, now);
    s.emailIndex[email] = guest.id;
    s.tokenIndex[newToken] = guest.id;
    guest.token = newToken;
    store.save();
    return { user: guest, token: newToken };
  }

  const id = `usr_${randomUUID().slice(0, 8)}`;
  const token = issueToken(1);
  const user: PersistedUser = {
    id,
    token,
    email,
    name: name?.trim() || undefined,
    registrationIdentity: { name: name?.trim() || undefined, email, registeredAt: now },
    passwordHash,
    passwordUpdatedAt: now,
    tokenVersion: 1,
    ageVerified: false,
    narrativeBoundary: DEFAULT_USER_BOUNDARY,
    ifUnlocked: false,
    createdAt: now,
    candle: grant,
    registerGrant: grant,
    conversationRounds: 0,
  };
  s.users[id] = user;
  s.tokenIndex[token] = id;
  s.emailIndex[email] = id;
  s.candleLedger.push({
    id: `cl_${randomUUID().slice(0, 8)}`,
    userId: id,
    delta: grant,
    reason: 'register_grant',
    refId: id,
    createdAt: user.createdAt,
  });
  store.save();
  return { user, token };
}

/**
 * 邮箱 + 密码登录。复用 loginWithPassword 的失败计数 / 锁定 / token 逻辑。
 * 没设密码（OTP-only 老用户绑定了邮箱但没设密码）→ NO_PASSWORD。
 */
export async function loginWithEmail(
  emailRaw: string,
  plain: string,
): Promise<{ user: PersistedUser; token: string }> {
  const s = store.state();
  const email = normalizeEmail(emailRaw);
  const id = s.emailIndex[email];
  if (!id) throw new PasswordError('NOT_FOUND', '账号或密码不正确');
  const u = s.users[id];
  if (!u) throw new PasswordError('NOT_FOUND', '账号或密码不正确');
  if (u.deletedAt) throw new PasswordError('NOT_FOUND', '账号或密码不正确');
  if (!u.passwordHash) throw new PasswordError('NO_PASSWORD', '此账号尚未设置密码');
  if (u.lockedUntil && Date.parse(u.lockedUntil) > Date.now()) {
    throw new PasswordError('LOCKED', '账号已锁定，请稍后再试');
  }
  const ok = await verifyPassword(plain, u.passwordHash);
  if (!ok) {
    u.failedLoginCount = (u.failedLoginCount ?? 0) + 1;
    if (u.failedLoginCount >= MAX_FAILED_LOGINS) {
      u.lockedUntil = new Date(Date.now() + LOCK_DURATION_MS).toISOString();
    }
    store.save();
    throw new PasswordError('WRONG', '账号或密码不正确');
  }
  u.failedLoginCount = 0;
  delete u.lockedUntil;
  const newToken = issueToken(u.tokenVersion ?? 0);
  s.tokenIndex[newToken] = u.id;
  u.token = newToken;
  store.save();
  return { user: u, token: newToken };
}

/**
 * 给当前账户绑定邮箱（首次设置或更换）。
 * - 无密码用户必须同时传 password，否则绑定后无法用邮箱登录（半成品状态）
 * - 已有密码用户可只传 email
 * - 唯一性：被他人占用 → EMAIL_TAKEN
 * - 更换：清掉旧 emailIndex 再写新的（原子）
 *
 * 不 bump tokenVersion —— bind 只是加 login 入口，不影响现有 session。
 * 但设了新密码会 bump（复用 setPassword 逻辑）。
 */
export async function bindEmail(
  userId: string,
  emailRaw: string,
  password?: string,
): Promise<{ user: PersistedUser; token?: string }> {
  const s = store.state();
  const u = s.users[userId];
  if (!u) throw new EmailAuthError('NOT_FOUND', 'user not found');
  if (u.deletedAt) throw new EmailAuthError('NOT_FOUND', 'user not found');
  const email = normalizeEmail(emailRaw);
  const existing = s.emailIndex[email];
  if (existing && existing !== userId) {
    throw new EmailAuthError('EMAIL_TAKEN', '该邮箱已被注册');
  }
  // 无密码 user 必须同时设密码 —— 不然 bind 完没用
  const isFirstPassword = !u.passwordHash;
  if (isFirstPassword) {
    if (!password) {
      throw new PasswordError('NO_PASSWORD', '首次绑定邮箱必须同时设置密码');
    }
    if (!isStrongPassword(password)) {
      throw new PasswordError('WEAK', '密码至少 8 位，需包含字母与数字');
    }
  }
  // 清旧 emailIndex（如果换了邮箱）
  if (u.email && u.email.toLowerCase() !== email) {
    delete s.emailIndex[u.email.toLowerCase()];
  }
  s.emailIndex[email] = userId;
  u.email = email;
  let newToken: string | undefined;
  // 仅在首次设置密码时调 setPassword（已有密码的绑定不该绕过 currentPassword 检查重置密码）
  if (isFirstPassword) {
    const setResult = await setPassword(userId, password!);
    newToken = setResult.token;
  } else {
    store.save();
  }
  return { user: u, token: newToken };
}

/**
 * 通过 OTP 重置密码（OTP 是身份证明）。
 * mock 环境任意 4-8 位数字 code 通过；生产路径在 apps/server 同步桩中实现真正验证。
 */
export async function resetPasswordViaOtp(
  phone: string,
  _code: string,
  newPassword: string,
): Promise<{ user: PersistedUser; token: string }> {
  if (!mockOtpForTestsOnly()) throw new PasswordError('WRONG', SMS_UNAVAILABLE_MESSAGE);
  const s = store.state();
  const id = s.phoneIndex[phone];
  if (!id) throw new PasswordError('NOT_FOUND', '账号不存在');
  const u = s.users[id];
  if (!u) throw new PasswordError('NOT_FOUND', '账号不存在');
  if (u.deletedAt) throw new PasswordError('NOT_FOUND', '账号不存在');
  if (!isStrongPassword(newPassword)) {
    throw new PasswordError('WEAK', '密码至少 8 位，需包含字母与数字');
  }
  u.passwordHash = await hashPassword(newPassword);
  u.passwordUpdatedAt = new Date().toISOString();
  u.failedLoginCount = 0;
  delete u.lockedUntil;
  const nextVersion = (u.tokenVersion ?? 0) + 1;
  u.tokenVersion = nextVersion;
  const newToken = issueToken(nextVersion);
  s.tokenIndex[newToken] = u.id;
  u.token = newToken;
  store.save();
  return { user: u, token: newToken };
}

// ── 手机号变更 / 注销（Phase 4） ─────────────────────────────

export class AccountError extends Error {
  constructor(
    public code: 'NOT_FOUND' | 'ANON_PROTECTED' | 'PHONE_TAKEN' | 'NEEDS_CONFIRMATION' | 'WRONG_PASSWORD',
    message: string,
  ) {
    super(message);
  }
}

// ANON_PHONE 共享匿名号 —— 绝不允许被改/删/绑定
// 必须与 middleware/auth.ts 的 ANON_PHONE 常量一致
const ANON_PHONE_GUARD = '00000000000';

/**
 * 改手机号。OTP 是新号的归属证明。
 * - 不允许把匿名号改成真号（必须先正常 OTP 登录）
 * - 不允许把任何号改成 ANON_PHONE
 * - 不允许冲突到他人手机号
 */
export async function changePhone(
  userId: string,
  newPhone: string,
  _code: string, // mock：任意 4-8 位数字都通过；prod 在 apps/server 验
): Promise<PersistedUser> {
  if (!mockOtpForTestsOnly()) throw new AccountError('NEEDS_CONFIRMATION', SMS_UNAVAILABLE_MESSAGE);
  const s = store.state();
  const u = s.users[userId];
  if (!u) throw new AccountError('NOT_FOUND', 'user not found');
  if (u.deletedAt) throw new AccountError('NOT_FOUND', 'user not found');
  if (newPhone === ANON_PHONE_GUARD) {
    throw new AccountError('ANON_PROTECTED', '不能绑定为匿名号');
  }
  if (u.phone === ANON_PHONE_GUARD) {
    throw new AccountError('ANON_PROTECTED', '匿名号不支持改号，请重新登录');
  }
  const existing = s.phoneIndex[newPhone];
  if (existing && existing !== userId) {
    throw new AccountError('PHONE_TAKEN', '该手机号已被占用');
  }
  // 原子改：先删旧 index（如有），再写新 index，再改 user.phone
  if (u.phone) delete s.phoneIndex[u.phone];
  s.phoneIndex[newPhone] = userId;
  u.phone = newPhone;
  u.phoneVerifiedAt = new Date().toISOString();
  store.save();
  return u;
}

/**
 * 注销账户（软删）。
 * - 二次确认：currentPassword（如有）或 OTP code（任一）。route 层校验。
 * - 写 deletedAt → 后续 requireAuth 拒绝、softAuth 降级到匿名
 * - 不删 phoneIndex（保留以防误回收）；30 天后真删放 backlog
 * - bump tokenVersion → 所有 token 立即失效
 */
export async function deleteAccount(
  userId: string,
  confirmation: { currentPassword?: string; code?: string },
): Promise<PersistedUser> {
  const s = store.state();
  const u = s.users[userId];
  if (!u) throw new AccountError('NOT_FOUND', 'user not found');
  if (u.deletedAt) return u;
  if (u.phone === ANON_PHONE_GUARD) {
    throw new AccountError('ANON_PROTECTED', '匿名号不能注销');
  }
  // 二次确认：有密码 → 必须密码或 OTP code 之一；无密码 → 必须 OTP code
  if (u.passwordHash) {
    const passOk = confirmation.currentPassword
      ? await verifyPassword(confirmation.currentPassword, u.passwordHash)
      : false;
    const otpOk = mockOtpForTestsOnly() && Boolean(confirmation.code);
    if (!passOk && !otpOk) {
      if (confirmation.currentPassword && !passOk) {
        throw new AccountError('WRONG_PASSWORD', '当前密码不正确');
      }
      throw new AccountError('NEEDS_CONFIRMATION', '需要密码或验证码二次确认');
    }
  } else {
    if (!mockOtpForTestsOnly() || !confirmation.code) throw new AccountError('NEEDS_CONFIRMATION', '需要有效的验证码二次确认；短信验证暂未开放');
  }
  u.deletedAt = new Date().toISOString();
  u.tokenVersion = (u.tokenVersion ?? 0) + 1;
  store.save();
  return u;
}

/** 强制登出所有设备：bump tokenVersion → 所有旧 token 失效。返回新 token。 */
export function revokeAllSessions(userId: string): { token: string } {
  const s = store.state();
  const u = s.users[userId];
  if (!u) throw new PasswordError('NOT_FOUND', 'user not found');
  const nextVersion = (u.tokenVersion ?? 0) + 1;
  u.tokenVersion = nextVersion;
  const newToken = issueToken(nextVersion);
  s.tokenIndex[newToken] = u.id;
  u.token = newToken;
  store.save();
  return { token: newToken };
}

/** 改烛账并写流水 */
export function adjustCandle(
  userId: string,
  delta: number,
  reason: string,
  refId?: string,
): { balance: number } {
  const s = store.state();
  const u = s.users[userId];
  if (!u) throw new Error(`user ${userId} not found`);
  if (u.candle + delta < 0) throw new Error('insufficient candle');
  u.candle += delta;
  s.candleLedger.push({
    id: `cl_${randomUUID().slice(0, 8)}`,
    userId,
    delta,
    reason,
    refId,
    createdAt: new Date().toISOString(),
  });
  store.save();
  return { balance: u.candle };
}

export function getCandleLedger(userId: string) {
  return store.state().candleLedger.filter((r) => r.userId === userId);
}

/** 获取或初始化今日额度行 */
export function getQuotaToday(userId: string): QuotaRow & { freeLimit: number; remaining: number } {
  return getQuotaForDate(userId);
}

export function getQuotaForDate(userId: string, date = currentQuotaDate()): QuotaRow & { freeLimit: number; remaining: number } {
  const row = ensureQuotaRow(userId, date);
  const freeLimit = effectiveFreeLimit(row);
  return {
    ...row,
    freeLimit,
    remaining: Math.max(0, freeLimit - row.freeUsed) + Math.max(0, row.bonusLimit - row.bonusUsed),
  };
}

export function resetQuotaForDate(userId: string, date = currentQuotaDate()): QuotaRow & { freeLimit: number; remaining: number } {
  const row = ensureQuotaRow(userId, date);
  row.freeUsed = 0;
  row.bonusUsed = 0;
  store.save();
  return getQuotaForDate(userId, date);
}

export function setQuotaForDate(
  userId: string,
  patch: {
    date?: string;
    freeLimit?: number | null;
    freeUsed?: number;
    bonusLimit?: number;
    bonusUsed?: number;
  },
): QuotaRow & { freeLimit: number; remaining: number } {
  const row = ensureQuotaRow(userId, patch.date ?? currentQuotaDate());
  if (patch.freeLimit !== undefined) {
    if (patch.freeLimit === null) delete row.freeLimit;
    else row.freeLimit = patch.freeLimit;
  }
  if (patch.freeUsed !== undefined) row.freeUsed = patch.freeUsed;
  if (patch.bonusLimit !== undefined) row.bonusLimit = patch.bonusLimit;
  if (patch.bonusUsed !== undefined) row.bonusUsed = patch.bonusUsed;
  store.save();
  return getQuotaForDate(userId, row.date);
}

/** 计 1 个免费配额；超额时尝试用 bonus；都不够返回 false */
export function consumeOneRound(userId: string): boolean {
  const s = store.state();
  const now = Date.now();
  const membershipDirty = refreshExpiredMembershipRows(s.subscriptions, now);
  if (hasActiveMembershipRow(s.subscriptions, userId, now)) {
    if (membershipDirty) store.save();
    return true;
  }
  if (membershipDirty) store.save();
  const row = ensureQuotaRow(userId);
  const freeLimit = effectiveFreeLimit(row);
  if (row.freeUsed < freeLimit) {
    row.freeUsed++;
    store.save();
    return true;
  }
  if (row.bonusUsed < row.bonusLimit) {
    row.bonusUsed++;
    store.save();
    return true;
  }
  return false;
}
