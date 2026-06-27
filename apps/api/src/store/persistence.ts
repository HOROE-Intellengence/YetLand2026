// JSON 文件持久化 — 让 candle/quota/sessions 跨进程重启
// 落盘点：apps/api/.local/state.json（写在 api 自己目录下，gitignore 友好）
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConstellationEdge, ConstellationPoint, Plan, PreferenceCategory, SidecarPromptKey, Subscription } from '@yelan/shared';
import type { ReasoningEffort } from '@yelan/llm';

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/store → apps/api/.local
// 测试环境强制重定向到独立目录 —— 防止 vitest 的 __resetForTests + scheduleSave
// 把真实 .local/state.json 推平（2026-05-16 与 2026-05-20 各踩过一次，留下
// state.json.testclobber-*.bak 与 state.json.clobbered-*.bak 化石）。
// 自定义 STATE_FILE env 也支持，便于 CI / 多实例隔离。
const IS_TEST = !!(process.env.VITEST || process.env.NODE_ENV === 'test');
const STATE_DIR = process.env.YELAN_STATE_DIR
  ? resolve(process.env.YELAN_STATE_DIR)
  : IS_TEST
    ? resolve(here, '..', '..', '.local-test')
    : resolve(here, '..', '..', '.local');
const STATE_FILE = process.env.YELAN_STATE_FILE
  ? resolve(process.env.YELAN_STATE_FILE)
  : join(STATE_DIR, 'state.json');
// 自动快照 + 损坏隔离都落在这里。保留上限 + 写时即修剪 → 文件数恒定有界，不会无限堆叠。
const SNAPSHOT_DIR = join(STATE_DIR, 'snapshots');
const MAX_SNAPSHOTS = 12;
const MAX_CORRUPT_COPIES = 5;
const SNAPSHOT_MIN_INTERVAL_MS = 30 * 60 * 1000;

export interface PersistedUser {
  id: string;
  name?: string;
  // phone 现在 optional —— email-auth phase 后，新用户可只用邮箱注册；
  // 老 phone 用户字段保留不变，UI 优先显示 email > phone。
  phone?: string;
  token: string;
  ageVerified: boolean;
  narrativeBoundary: 1 | 2 | 3 | 4 | 5;
  ifUnlocked: boolean;
  createdAt: string;
  candle: number;
  registerGrant: number;
  conversationRounds: number;
  lastPreferenceConsolidatedRound?: number;
  // —— 账户档案扩展（feat/user-account, Phase 1）——
  email?: string;
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  // —— 账户安全（passwordHash 已在注册/改密/重置实写，见 services/users.ts；其余字段 Phase 3/4 落实）——
  passwordHash?: string;
  passwordUpdatedAt?: string;
  phoneVerifiedAt?: string;
  // 用于密码改动 / 强制登出时 bump，使旧 token 失效
  tokenVersion?: number;
  // 失败计数与锁定（密码登录用，Phase 3 落实）
  failedLoginCount?: number;
  lockedUntil?: string;
  // 软删时间（Phase 4 注销账户用）
  deletedAt?: string;
}

export interface QuotaRow {
  date: string;
  freeLimit?: number;
  freeUsed: number;
  bonusUsed: number;
  bonusLimit: number;
}

export interface CandleLedgerRow {
  id: string;
  userId: string;
  delta: number;
  reason: string;
  refId?: string;
  createdAt: string;
}

export type MembershipPlanRow = Plan;
export type SubscriptionRow = Subscription & {
  currentPeriodStart: string;
  cancelAtPeriodEnd: boolean;
  gatewayEventId?: string;
  createdAt: string;
  updatedAt: string;
};

export interface SessionRow {
  id: string;
  userId: string;
  characterId: string;
  // 开发文档 §四.3：conversation_sessions.mode ENUM('main','if')
  mode: 'main' | 'if';
  ifActive?: boolean;
  round: number;
  prevStage: 'daily' | 'rise' | 'climax' | 'after' | 'end';
  lastMemoryRound?: number;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRow {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

export interface ConversationLogRow {
  id: string;
  userId: string;
  sessionId: string;
  payload: unknown;
  createdAt: string;
}

export interface IfCodeDef {
  code: string;
  boundary: 1 | 2 | 3 | 4 | 5;
  source: string;
  active: boolean;
  // 可选：命中暗号当轮的「瞬时升温」目标温度。仅作用于命中那一轮，不留地板；
  // 下一轮起温度完全交还 atmosphereJudge。未配置则不强制改温。
  temperature?: 1 | 2 | 3 | 4 | 5;
}

export interface AdminAuditRow {
  id: string;
  ts: string;
  action: string;
  actor: string;
  target?: string;
  reason?: string;
  payload?: unknown;
}

export interface CharacterRow {
  id: string;
  slug: string;
  name: string;
  rarity: 'free' | 'paid' | 'hidden';
  priceCandle: number;
  styleTags: string[];
  promptCardKey?: string;
  preludeCardId?: string | null;
  boundaryDefault: 1 | 2 | 3 | 4 | 5;
  isActive: boolean;
  openingFirstVisit: string;
  openingReturnVisit: string;
  forbiddenPhrases: string[];
  description: string;
  profileSections?: { key: string; value: string; order: number }[];
  updatedAt: string;
}

// 介绍页星座 —— 独立存储，按角色 slug 关联（与角色卡分表，读公共列表时 join）
export interface ConstellationRow {
  slug: string;
  points: ConstellationPoint[];
  edges: ConstellationEdge[];
  updatedAt: string;
}

// BE-102 — 长期记忆
export interface UserPreferenceRow {
  id: string;
  userId: string;
  characterId: string;
  mode: 'main' | 'if';
  text: string;
  category: PreferenceCategory;
  embedding?: number[]; // 本地算后上传的向量
  weight: number;
  lastUsedAt: string;
  updatedAt: string;
  tombstone: boolean; // 软删标记
}

export interface UserEventRow {
  id: string;
  userId: string;
  characterId: string;
  mode: 'main' | 'if';
  date: string;
  text: string;
  embedding?: number[];
  emotion?: string;
  updatedAt: string;
  tombstone: boolean;
}

// BE-103 — UI 偏好
export interface UserUIPrefRow {
  userId: string;
  theme: 'dark' | 'light';
  fontScale: number;
  locale: string;
  stageLayoutOverrides: Record<string, unknown>;
  updatedAt: string;
}

// BE-104 — 用量规则
export interface PolicyKvRow {
  key: string;
  value: string | number | boolean;
  updatedBy: string;
  updatedAt: string;
}

export interface PreludeCardRow {
  id: string;
  name: string;
  content: string;
  scope: 'global' | 'character' | 'if';
  characterId?: string | null;
  priority: number;
  isActive: boolean;
  updatedAt: string;
}

export interface LlmApiEntry {
  id: string;
  name: string;
  protocol: 'openai-compatible' | 'anthropic' | 'nvidia';
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SurveyDefinitionRow {
  id: string;
  title: string;
  rewardCandle: number;
  status: 'active' | 'inactive';
  questions: {
    id: string;
    type: 'single' | 'multi' | 'text' | 'scale';
    title: string;
    options?: { value: string; label: string }[];
    minSeconds: number;
  }[];
  updatedAt: string;
}

export interface UserProfileFactRow {
  id: string;
  userId: string;
  characterId: string;
  scope: 'global' | 'character' | 'if';
  type: 'preference' | 'event' | 'relationship';
  text: string;
  confidence: number;
  status: 'active' | 'superseded' | 'rejected';
  source: 'sidecar' | 'user' | 'system';
  sourceSessionId?: string;
  updatedAt: string;
}

export interface UserProfileChangelogRow {
  id: string;
  userId: string;
  characterId: string;
  sourceSessionId?: string;
  summary: string;
  preferences: string[];
  events: { date: string; text: string; emotion?: string }[];
  relationshipState?: string;
  createdAt: string;
}

interface PersistedState {
  version: 1;
  users: Record<string, PersistedUser>;
  tokenIndex: Record<string, string>; // token → userId
  phoneIndex: Record<string, string>; // phone → userId
  emailIndex: Record<string, string>; // email(lowercased) → userId
  quota: Record<string, Record<string, QuotaRow>>; // userId → date → row
  candleLedger: CandleLedgerRow[];
  sessions: Record<string, SessionRow>;
  messages: Record<string, MessageRow[]>; // sessionId → rows
  conversationLogs: ConversationLogRow[];
  ifCodes: IfCodeDef[];
  ifRedemptions: { userId: string; code: string; ts: string }[];
  adminAudit: AdminAuditRow[];
  surveys: {
    definitions: Record<string, SurveyDefinitionRow>;
    submissions: {
      userId: string;
      surveyId: string;
      rewarded: number;
      ts: string;
      answers?: { questionId: string; answer: unknown; dwellMs: number }[];
      source?: string;
    }[];
  };
  payments: { id: string; provider: string; userId: string; amount: number; status: string; ts: string }[];
  membershipPlans: Record<string, MembershipPlanRow>;
  subscriptions: Record<string, SubscriptionRow>;
  freeLimitOverride: number | null;
  prompts: { versions: { id: string; key: string; value: string; activeAt: string | null; createdAt: string }[] };
  costsDaily: { date: string; cost: number; tokens: number; calls: number }[];
  characters: Record<string, CharacterRow>;
  // 介绍页星座：slug → 运营自定义星座（缺省则前端回退内置默认，不在此存）
  constellations: Record<string, ConstellationRow>;
  preludeCards: Record<string, PreludeCardRow>;
  // BE-102
  userPreferences: Record<string, UserPreferenceRow>;
  userEvents: Record<string, UserEventRow>;
  // BE-103
  userUIPreferences: Record<string, UserUIPrefRow>;
  // BE-104
  policies: Record<string, PolicyKvRow>;
  // 用户已解锁成就：userId → 解锁记录列表
  userAchievements: Record<string, { achievementId: string; unlockedAt: string; sessionId?: string }[]>;
  // 侧袋 AI：admin 可修改的 5 个 prompt
  sidecarPrompts: {
    preferenceRecorder?: string;
    outputStructurer?: string;
    atmosphereJudge?: string;
    quotaEnding?: string;
    contextCompressor?: string;
  };
  // 侧袋 AI：独立开关 + 执行顺序
  sidecarEnabled: {
    preferenceRecorder: boolean;
    outputStructurer: boolean;
    atmosphereJudge: boolean;
    quotaEnding: boolean;
    contextCompressor: boolean;
  };
  sidecarOrder: ('preferenceRecorder' | 'outputStructurer' | 'atmosphereJudge' | 'quotaEnding' | 'contextCompressor')[];
  // 侧袋 AI 产出：用户画像
  userProfiles: Record<string, { markdown: string; updatedAt: string }>;
  userProfileFacts: Record<string, UserProfileFactRow>;
  userProfileChangelog: UserProfileChangelogRow[];
  // 侧袋 AI 产出：上下文概要
  contextSummaries: Record<string, { summary: string; updatedAt: string; compressedUntilMessageId?: string }>;
  // 侧袋 AI 产出：会话温度日志
  temperatureLogs: Record<string, { values: number[]; updatedAt: string }>;
  llmApiInventory: {
    entries: Record<string, LlmApiEntry>;
    mainApiId: string | null;
    sidecarApiId: string | null;
    sidecarTaskApiIds: Partial<Record<SidecarPromptKey, string | null>>;
    // 主 AI 推理档位（reasoning_effort）。普通场景默认 'low'（原为不传≈minimal）；
    // 暗号(IF 解锁)场景单独分档。仅在主模型族支持时才真正进 body。
    mainReasoningEffort?: ReasoningEffort;
    mainReasoningEffortCipher?: ReasoningEffort;
  };
}

function defaultState(): PersistedState {
  return {
    version: 1,
    users: {},
    tokenIndex: {},
    phoneIndex: {},
    emailIndex: {},
    quota: {},
    candleLedger: [],
    sessions: {},
    messages: {},
    conversationLogs: [],
    ifCodes: [
      { code: 'YELAN-DAWN', boundary: 3, source: 'seed', active: true },
      { code: 'YELAN-MOON', boundary: 4, source: 'seed', active: true },
    ],
    ifRedemptions: [],
    adminAudit: [],
    surveys: { definitions: {}, submissions: [] },
    payments: [],
    membershipPlans: {},
    subscriptions: {},
    freeLimitOverride: null,
    prompts: { versions: [] },
    costsDaily: [],
    characters: {},
    constellations: {},
    preludeCards: {},
    userPreferences: {},
    userEvents: {},
    userUIPreferences: {},
    policies: {},
    userAchievements: {},
    sidecarPrompts: {},
    sidecarEnabled: { preferenceRecorder: true, outputStructurer: true, atmosphereJudge: true, quotaEnding: true, contextCompressor: true },
    sidecarOrder: ['atmosphereJudge', 'outputStructurer', 'preferenceRecorder', 'quotaEnding', 'contextCompressor'],
    userProfiles: {},
    userProfileFacts: {},
    userProfileChangelog: [],
    contextSummaries: {},
    temperatureLogs: {},
    llmApiInventory: {
      entries: {},
      mainApiId: null,
      sidecarApiId: null,
      sidecarTaskApiIds: {},
      mainReasoningEffort: 'low',
      mainReasoningEffortCipher: 'low',
    },
  };
}

let _state: PersistedState | null = null;
let _saveTimer: NodeJS.Timeout | null = null;
let _normalizeDirty = false;

function markNormalizeDirty(): void {
  _normalizeDirty = true;
}

/** 把磁盘读到的对象补全默认值 + 回填旧数据 + 修脏 order —— 两条加载路径共用 */
function normalizeLoadedState(parsed: PersistedState): PersistedState {
  const s: PersistedState = { ...defaultState(), ...parsed };
  if (!s.llmApiInventory) {
    s.llmApiInventory = {
      entries: {},
      mainApiId: null,
      sidecarApiId: null,
      sidecarTaskApiIds: {},
      mainReasoningEffort: 'low',
      mainReasoningEffortCipher: 'low',
    };
    markNormalizeDirty();
  } else if (!s.llmApiInventory.sidecarTaskApiIds) {
    s.llmApiInventory.sidecarTaskApiIds = {};
    markNormalizeDirty();
  }
  // 旧 state 没有推理档位字段 → 回填默认 'low'
  if (s.llmApiInventory.mainReasoningEffort === undefined) {
    s.llmApiInventory.mainReasoningEffort = 'low';
    markNormalizeDirty();
  }
  if (s.llmApiInventory.mainReasoningEffortCipher === undefined) {
    s.llmApiInventory.mainReasoningEffortCipher = 'low';
    markNormalizeDirty();
  }
  // emailIndex 旧 state 没有 → 兜底 + 从 user.email 回填，保证 email login 走得通
  if (!s.emailIndex) {
    s.emailIndex = {};
    markNormalizeDirty();
  }
  const needsEmailBackfill = Object.values(s.users).some(
    (u) => typeof u.email === 'string' && u.email && !s.emailIndex[u.email.toLowerCase()],
  );
  if (needsEmailBackfill) {
    for (const u of Object.values(s.users)) {
      if (typeof u.email === 'string' && u.email) {
        const key = u.email.toLowerCase();
        if (!s.emailIndex[key]) s.emailIndex[key] = u.id;
      }
    }
    markNormalizeDirty();
  }
  const needsRoundBackfill = Object.values(s.users).some((u) => typeof u.conversationRounds !== 'number');
  if (needsRoundBackfill) {
    const counts: Record<string, number> = {};
    for (const [sessionId, messages] of Object.entries(s.messages)) {
      const userId = s.sessions[sessionId]?.userId;
      if (!userId) continue;
      counts[userId] = (counts[userId] ?? 0) + messages.filter((m) => m.role === 'user').length;
    }
    for (const user of Object.values(s.users)) {
      user.conversationRounds = counts[user.id] ?? 0;
    }
    markNormalizeDirty();
  }
  // 旧数据回填：未带 mode 的会话默认为 main
  for (const sess of Object.values(s.sessions)) {
    if (!sess.mode) sess.mode = 'main';
    if (sess.ifActive === undefined) sess.ifActive = sess.mode === 'if';
  }
  for (const pref of Object.values(s.userPreferences)) {
    if (!pref.category) {
      pref.category = 'other';
      markNormalizeDirty();
    }
  }
  if (!s.constellations) {
    s.constellations = {};
    markNormalizeDirty();
  }
  if (!s.surveys) s.surveys = { definitions: {}, submissions: [] };
  if (!s.surveys.definitions) s.surveys.definitions = {};
  if (!s.surveys.submissions) s.surveys.submissions = [];
  if (!s.membershipPlans) s.membershipPlans = {};
  if (!s.subscriptions) s.subscriptions = {};
  // 侧袋编排旧数据回填 + 脏 order 修复
  if (!s.sidecarEnabled) {
    s.sidecarEnabled = { preferenceRecorder: true, outputStructurer: true, atmosphereJudge: true, quotaEnding: true, contextCompressor: true };
  }
  const order = s.sidecarOrder;
  let dirty = !order || !Array.isArray(order) || order.length !== 5;
  if (!dirty) {
    const seen = new Set<string>();
    for (const k of order) {
      if (typeof k !== 'string' || seen.has(k) || !['atmosphereJudge','outputStructurer','preferenceRecorder','quotaEnding','contextCompressor'].includes(k)) { dirty = true; break; }
      seen.add(k);
    }
    if (seen.size !== 5) dirty = true;
  }
  if (dirty) s.sidecarOrder = ['atmosphereJudge','outputStructurer','preferenceRecorder','quotaEnding','contextCompressor'] as PersistedState['sidecarOrder'];
  return s;
}

/** 列出目录下指定前缀的 .json 文件，按修改时间新→旧排序 */
export function listSnapshotFiles(dir: string, prefix: string): { path: string; mtimeMs: number }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(prefix) && f.endsWith('.json'))
    .map((f) => {
      const path = join(dir, f);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

/** 写时修剪：只保留指定前缀最新的 keep 个文件 —— 数量封顶，杜绝无限堆叠 */
export function pruneSnapshots(dir: string, prefix: string, keep: number): void {
  for (const { path } of listSnapshotFiles(dir, prefix).slice(keep)) {
    try { unlinkSync(path); } catch { /* 删除失败不致命，下次写入再修剪 */ }
  }
}

/** state.json 解析失败时把坏文件原样隔离到 snapshots/ —— 绝不静默丢弃。dir 参数为可测性而设 */
export function quarantineCorruptState(dir: string, raw: string): void {
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(dir, `corrupt-${ts}.json`), raw, 'utf8');
    pruneSnapshots(dir, 'corrupt-', MAX_CORRUPT_COPIES);
  } catch (e) {
    console.warn('[persistence] quarantine failed:', (e as Error).message);
  }
}

/** 损坏后尝试从最新的可解析快照恢复；都失败返回 null。dir 参数为可测性而设 */
export function recoverFromSnapshot(dir: string): PersistedState | null {
  for (const { path } of listSnapshotFiles(dir, 'snapshot-')) {
    try {
      return normalizeLoadedState(JSON.parse(readFileSync(path, 'utf8')) as PersistedState);
    } catch { /* 这份快照也坏，试更旧的 */ }
  }
  return null;
}

/** 空/默认状态不值得快照 —— 否则一次事故就能把好快照挤出保留窗口 */
function isStateWorthSnapshotting(s: PersistedState): boolean {
  return Object.keys(s.users).length > 0 || Object.keys(s.characters).length > 0;
}

/** 自动快照当前内存状态：测试零快照 / 节流 / 非平凡 / 数量封顶 */
function maybeSnapshot(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (!_state || !isStateWorthSnapshotting(_state)) return;
  try {
    if (!existsSync(SNAPSHOT_DIR)) mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const newest = listSnapshotFiles(SNAPSHOT_DIR, 'snapshot-')[0];
    // 节流：距上次快照不足 interval 直接跳过
    if (newest && Date.now() - newest.mtimeMs < SNAPSHOT_MIN_INTERVAL_MS) return;
    const serialized = JSON.stringify(_state, null, 2);
    // 内容去重：与上次快照逐字节相同则不写。开发期 tsx watch 频繁重启、
    // 并发引导会绕过时间节流，去重保证「状态没变就不产生噪声快照」。
    if (newest) {
      try {
        if (readFileSync(newest.path, 'utf8') === serialized) return;
      } catch { /* 读不出就当作已变更，继续写 */ }
    }
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(SNAPSHOT_DIR, `snapshot-${ts}.json`), serialized, 'utf8');
    pruneSnapshots(SNAPSHOT_DIR, 'snapshot-', MAX_SNAPSHOTS);
  } catch (e) {
    console.warn('[persistence] snapshot failed:', (e as Error).message);
  }
}

function ensureLoaded(): PersistedState {
  if (_state) return _state;
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  if (!existsSync(STATE_FILE)) {
    _state = defaultState();
    return _state;
  }
  const raw = readFileSync(STATE_FILE, 'utf8');
  try {
    _state = normalizeLoadedState(JSON.parse(raw) as PersistedState);
  } catch (e) {
    // 解析失败：绝不静默清空。先隔离坏文件，再尝试从快照恢复。
    console.error('[persistence] state.json parse FAILED:', (e as Error).message);
    quarantineCorruptState(SNAPSHOT_DIR, raw);
    const recovered = recoverFromSnapshot(SNAPSHOT_DIR);
    if (recovered) {
      _state = recovered;
      console.warn('[persistence] recovered state from latest snapshot');
    } else {
      _state = defaultState();
      console.error('[persistence] no usable snapshot — starting empty; corrupt file saved in .local/snapshots/');
    }
  }
  maybeSnapshot();
  if (_normalizeDirty) {
    scheduleSave();
    _normalizeDirty = false;
  }
  return _state;
}

/** 原子落盘：先写临时文件再 rename —— rename 不可中断，写到一半被打断也不会损坏 state.json */
function writeStateAtomic(serialized: string): void {
  const tmp = `${STATE_FILE}.tmp`;
  writeFileSync(tmp, serialized, 'utf8');
  renameSync(tmp, STATE_FILE);
}

function scheduleSave(): void {
  if (process.env.NODE_ENV === 'test') return;
  if (_saveTimer) return;
  _saveTimer = setTimeout(() => {
    _saveTimer = null;
    try {
      writeStateAtomic(JSON.stringify(_state, null, 2));
      maybeSnapshot();
    } catch (e) {
      console.warn('[persistence] save failed:', (e as Error).message);
    }
  }, 200);
}

/**
 * 只追加遥测数组的保留上限 —— state.json 每次 save 都全量重写，纯日志无限堆叠会
 * 线性拖慢落盘并撑大内存。这是 ADR-0010（迁 Postgres）落地前的过渡护栏。
 * 财务（candleLedger / payments）与审计（adminAudit）数据敏感，不在此自动修剪。
 */
export const LOG_RETENTION = {
  conversationLogs: 5000,
} as const;

/** 向只追加数组 push 后就地修剪到尾部 max 条（保留最近的）。 */
export function pushBounded<T>(arr: T[], row: T, max: number): void {
  arr.push(row);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

export const store = {
  state(): PersistedState {
    return ensureLoaded();
  },
  save(): void {
    scheduleSave();
  },
  /** 同步落盘 — 退出钩子用 */
  saveNow(): void {
    if (!_state) return;
    // 测试进程退出时绝不可落盘：vitest 用 __resetForTests 把 _state 重置成
    // defaultState，若此处写盘会用测试垃圾覆盖真实的 .local/state.json。
    if (process.env.NODE_ENV === 'test') return;
    try {
      if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
      writeStateAtomic(JSON.stringify(_state, null, 2));
    } catch (e) {
      console.warn('[persistence] saveNow failed:', (e as Error).message);
    }
  },
  /** 测试专用：重置内存状态，避免污染 .local/state.json */
  __resetForTests(): void {
    _state = defaultState();
    if (_saveTimer) {
      clearTimeout(_saveTimer);
      _saveTimer = null;
    }
  },
};

// 进程退出时 flush
if (typeof process !== 'undefined') {
  const flush = () => store.saveNow();
  process.on('exit', flush);
  process.on('SIGINT', () => {
    flush();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    flush();
    process.exit(0);
  });
}
