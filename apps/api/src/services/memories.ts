// BE-102 — 长期记忆服务端 service
// 长期记忆真理源在服务端 state.json；客户端 Dexie 仅做缓存
import { randomUUID } from 'node:crypto';
import { store, type UserPreferenceRow, type UserEventRow, type UserProfileFactRow } from '../store/persistence';
import { adminAuditRepo } from '../store/repositories';
import type { PreferenceCategory } from '@yelan/shared';

function now(): string {
  return new Date().toISOString();
}

// ── 偏好 ──

export const DEFAULT_PREFERENCE_CATEGORY: PreferenceCategory = 'other';
export const PREFERENCE_CONSOLIDATION_ACTIVE_THRESHOLD = 30;
export const PREFERENCE_CONSOLIDATION_ROUND_INTERVAL = 20;
export const PREFERENCE_CHANGELOG_KEEP = 50;

const PREFERENCE_WEIGHT_CAP = 20;
const PREFERENCE_DECAY_HALF_LIFE_DAYS = 45;
const PREFERENCE_DECAY_MIN_AGE_DAYS = 60;
const PREFERENCE_EFFECTIVE_WEIGHT_MIN = 0.35;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const CATEGORY_PRIORITY: Record<PreferenceCategory, number> = {
  other: 0,
  preference: 1,
  fact: 2,
  relationship: 3,
  address: 4,
  boundary: 5,
};

const CATEGORY_LIMITS: Record<PreferenceCategory, number> = {
  address: Number.POSITIVE_INFINITY,
  boundary: Number.POSITIVE_INFINITY,
  preference: 20,
  fact: 20,
  relationship: 12,
  other: 10,
};

function isPreferenceCategory(value: string): value is PreferenceCategory {
  return ['address', 'boundary', 'preference', 'fact', 'relationship', 'other'].includes(value);
}

export function normalizePreferenceCategory(category?: string | null): PreferenceCategory {
  const clean = (category ?? '').trim().toLowerCase();
  if (isPreferenceCategory(clean)) return clean;
  if (['称呼', '稱呼', '叫法', '昵称', '暱稱', 'display name', 'name', 'call'].includes(clean)) return 'address';
  if (['边界', '邊界', '边界禁忌', '禁忌', '雷点', '雷點', 'boundary', 'taboo'].includes(clean)) return 'boundary';
  if (['喜好', '偏好', '口味', '风格', '風格', 'preference', 'like'].includes(clean)) return 'preference';
  if (['事实', '事實', '客观信息', '客觀信息', 'fact'].includes(clean)) return 'fact';
  if (['关系', '關係', '关系状态', '關係狀態', 'relationship'].includes(clean)) return 'relationship';
  return DEFAULT_PREFERENCE_CATEGORY;
}

export function normalizePreferenceText(text: string): string {
  return text
    .trim()
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '');
}

function timestampMs(value: string | undefined): number {
  const parsed = Date.parse(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

function newerTimestamp(a: string, b: string): string {
  return timestampMs(a) >= timestampMs(b) ? a : b;
}

function strongerCategory(a: PreferenceCategory, b: PreferenceCategory): PreferenceCategory {
  return CATEGORY_PRIORITY[b] > CATEGORY_PRIORITY[a] ? b : a;
}

function isProtectedPreference(row: UserPreferenceRow): boolean {
  return row.category === 'address' || row.category === 'boundary';
}

function scoreCanonical(row: UserPreferenceRow): number {
  return row.weight * 1_000_000 + timestampMs(row.lastUsedAt) + (row.embedding ? 10_000 : 0);
}

function tombstonePreference(row: UserPreferenceRow, updatedAt: string): void {
  row.tombstone = true;
  row.lastUsedAt = updatedAt;
  row.updatedAt = updatedAt;
}

function activePreferencesForUser(userId: string): UserPreferenceRow[] {
  return Object.values(store.state().userPreferences)
    .filter((row) => row.userId === userId && !row.tombstone);
}

export function getActivePreferenceCount(userId: string): number {
  return activePreferencesForUser(userId).length;
}

export function shouldConsolidatePreferences(userId: string): boolean {
  const s = store.state();
  const activeCount = getActivePreferenceCount(userId);
  if (activeCount > PREFERENCE_CONSOLIDATION_ACTIVE_THRESHOLD) return true;

  const user = s.users[userId];
  const rounds = user?.conversationRounds ?? 0;
  const lastRound = user?.lastPreferenceConsolidatedRound ?? 0;
  return activeCount > 0 && rounds - lastRound >= PREFERENCE_CONSOLIDATION_ROUND_INTERVAL;
}

export function listPreferences(userId: string, since?: string): UserPreferenceRow[] {
  const all = Object.values(store.state().userPreferences);
  const byUser = all.filter((r) => r.userId === userId);
  if (since) return byUser.filter((r) => (r.updatedAt ?? r.lastUsedAt) >= since);
  return byUser.filter((r) => !r.tombstone);
}

export function upsertPreferenceRow(
  userId: string,
  input: { id?: string; characterId: string; mode: 'main' | 'if'; branchId?: string; text: string; category?: string; embedding?: number[]; weight?: number },
  updatedAt = now(),
): UserPreferenceRow | null {
  const s = store.state();
  const text = input.text.trim().slice(0, 2000);
  if (!text) return null;

  const category = normalizePreferenceCategory(input.category);
  const normalized = normalizePreferenceText(text);
  const explicit = input.id ? s.userPreferences[input.id] : undefined;
  const existing = explicit?.userId === userId
    ? explicit
    : activePreferencesForUser(userId).find((row) =>
      row.characterId === input.characterId
      && row.mode === input.mode
      && row.branchId === input.branchId
      && normalizePreferenceText(row.text) === normalized,
    );

  if (existing) {
    existing.characterId = input.characterId;
    existing.mode = input.mode;
    existing.branchId = input.branchId;
    existing.text = text;
    existing.category = strongerCategory(existing.category ?? DEFAULT_PREFERENCE_CATEGORY, category);
    existing.embedding = input.embedding ?? existing.embedding;
    existing.weight = input.id ? (input.weight ?? existing.weight ?? 1) : Math.min(PREFERENCE_WEIGHT_CAP, (existing.weight ?? 1) + (input.weight ?? 1));
    existing.lastUsedAt = updatedAt;
    existing.updatedAt = updatedAt;
    existing.tombstone = false;
    return existing;
  }

  const id = input.id && !s.userPreferences[input.id] ? input.id : `pref_${randomUUID().slice(0, 8)}`;
  const row: UserPreferenceRow = {
    id,
    userId,
    characterId: input.characterId,
    branchId: input.branchId,
    mode: input.mode,
    text,
    category,
    embedding: input.embedding,
    weight: input.weight ?? 1,
    lastUsedAt: updatedAt,
    updatedAt,
    tombstone: false,
  };
  s.userPreferences[id] = row;
  return row;
}

export function upsertPreferences(
  userId: string,
  rows: { id?: string; characterId: string; mode: 'main' | 'if'; text: string; category?: string; embedding?: number[]; weight?: number }[],
): UserPreferenceRow[] {
  const results: UserPreferenceRow[] = [];
  for (const input of rows) {
    const row = upsertPreferenceRow(userId, input);
    if (row) results.push(row);
  }
  store.save();
  return results;
}

export interface PreferenceConsolidationStats {
  activeBefore: number;
  activeAfter: number;
  merged: number;
  tombstoned: number;
  changelogPruned: number;
}

export function consolidatePreferences(userId: string, updatedAt = now()): PreferenceConsolidationStats {
  const s = store.state();
  const activeBefore = activePreferencesForUser(userId);
  let merged = 0;
  let tombstoned = 0;

  const groups = new Map<string, UserPreferenceRow[]>();
  for (const row of activeBefore) {
    const key = `${row.characterId}\u0000${row.mode}\u0000${row.branchId ?? ''}\u0000${normalizePreferenceText(row.text)}`;
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const canonical = group.reduce((best, row) => (scoreCanonical(row) > scoreCanonical(best) ? row : best), group[0]!);
    for (const row of group) {
      if (row.id === canonical.id) continue;
      canonical.weight = Math.min(PREFERENCE_WEIGHT_CAP, canonical.weight + row.weight);
      canonical.category = strongerCategory(canonical.category, row.category);
      canonical.lastUsedAt = newerTimestamp(canonical.lastUsedAt, row.lastUsedAt);
      if (!canonical.embedding && row.embedding) canonical.embedding = row.embedding;
      tombstonePreference(row, updatedAt);
      merged += 1;
      tombstoned += 1;
    }
    canonical.updatedAt = updatedAt;
  }

  const nowMs = timestampMs(updatedAt);
  for (const row of activePreferencesForUser(userId)) {
    if (isProtectedPreference(row)) continue;
    const ageDays = Math.max(0, (nowMs - timestampMs(row.lastUsedAt)) / MS_PER_DAY);
    if (ageDays < PREFERENCE_DECAY_MIN_AGE_DAYS) continue;
    const effectiveWeight = row.weight * Math.pow(0.5, ageDays / PREFERENCE_DECAY_HALF_LIFE_DAYS);
    if (effectiveWeight < PREFERENCE_EFFECTIVE_WEIGHT_MIN) {
      tombstonePreference(row, updatedAt);
      tombstoned += 1;
    }
  }

  const limitGroups = new Map<string, UserPreferenceRow[]>();
  for (const row of activePreferencesForUser(userId)) {
    const key = `${row.characterId}\u0000${row.mode}\u0000${row.branchId ?? ''}\u0000${row.category}`;
    const group = limitGroups.get(key) ?? [];
    group.push(row);
    limitGroups.set(key, group);
  }
  for (const group of limitGroups.values()) {
    const category = group[0]?.category ?? DEFAULT_PREFERENCE_CATEGORY;
    const limit = CATEGORY_LIMITS[category];
    if (!Number.isFinite(limit) || group.length <= limit) continue;
    group
      .sort((a, b) => scoreCanonical(b) - scoreCanonical(a))
      .slice(limit)
      .forEach((row) => {
        if (isProtectedPreference(row)) return;
        tombstonePreference(row, updatedAt);
        tombstoned += 1;
      });
  }

  const userLogs = s.userProfileChangelog
    .filter((entry) => entry.userId === userId)
    .sort((a, b) => timestampMs(b.createdAt) - timestampMs(a.createdAt));
  const keepLogIds = new Set(userLogs.slice(0, PREFERENCE_CHANGELOG_KEEP).map((entry) => entry.id));
  const beforeLogs = s.userProfileChangelog.length;
  s.userProfileChangelog = s.userProfileChangelog.filter((entry) => entry.userId !== userId || keepLogIds.has(entry.id));
  const changelogPruned = beforeLogs - s.userProfileChangelog.length;

  const user = s.users[userId];
  if (user) user.lastPreferenceConsolidatedRound = user.conversationRounds ?? 0;

  const activeAfter = getActivePreferenceCount(userId);
  store.save();
  return { activeBefore: activeBefore.length, activeAfter, merged, tombstoned, changelogPruned };
}

export function deletePreference(userId: string, id: string): boolean {
  const s = store.state();
  const row = s.userPreferences[id];
  if (!row || row.userId !== userId) return false;
  row.tombstone = true;
  row.lastUsedAt = now();
  row.updatedAt = now();
  store.save();
  return true;
}

// ── 事件 ──

export function listEvents(userId: string, since?: string): UserEventRow[] {
  const all = Object.values(store.state().userEvents);
  const byUser = all.filter((r) => r.userId === userId);
  if (since) return byUser.filter((r) => (r.updatedAt ?? r.date) >= since);
  return byUser.filter((r) => !r.tombstone);
}

export function upsertEvents(
  userId: string,
  rows: { id?: string; characterId: string; mode: 'main' | 'if'; date: string; text: string; embedding?: number[]; emotion?: string }[],
): UserEventRow[] {
  const s = store.state();
  const results: UserEventRow[] = [];
  for (const input of rows) {
    const id = input.id ?? `evt_${randomUUID().slice(0, 8)}`;
    const prev = s.userEvents[id];
    const row: UserEventRow = {
      id,
      userId,
      characterId: input.characterId,
      mode: input.mode,
      date: input.date,
      text: input.text,
      embedding: input.embedding ?? prev?.embedding,
      emotion: input.emotion ?? prev?.emotion,
      updatedAt: now(),
      tombstone: false,
    };
    s.userEvents[id] = row;
    results.push(row);
  }
  store.save();
  return results;
}

export function deleteEvent(userId: string, id: string): boolean {
  const s = store.state();
  const row = s.userEvents[id];
  if (!row || row.userId !== userId) return false;
  row.tombstone = true;
  row.updatedAt = now();
  store.save();
  return true;
}

export function deleteAllMemories(userId: string): {
  preferences: number;
  events: number;
  profiles: number;
  profileFacts: number;
  profileChangelog: number;
  contextSummaries: number;
} {
  const s = store.state();
  let preferences = 0;
  let events = 0;
  let profiles = 0;
  let profileFacts = 0;
  let profileChangelog = 0;
  let contextSummaries = 0;
  for (const row of Object.values(s.userPreferences)) {
    if (row.userId !== userId || row.tombstone) continue;
    row.tombstone = true;
    row.lastUsedAt = now();
    row.updatedAt = now();
    preferences += 1;
  }
  for (const row of Object.values(s.userEvents)) {
    if (row.userId !== userId || row.tombstone) continue;
    row.tombstone = true;
    row.updatedAt = now();
    events += 1;
  }

  if (s.userProfiles[userId]) {
    delete s.userProfiles[userId];
    profiles = 1;
  }
  for (const key of Object.keys(s.scopedMemoryProfiles ?? {})) {
    if (JSON.parse(key)[0] === userId) {
      delete s.scopedMemoryProfiles![key];
      profiles += 1;
    }
  }
  for (const [key, receipt] of Object.entries(s.phoneMemoryReceipts ?? {})) {
    if (receipt.userId === userId) delete s.phoneMemoryReceipts![key];
  }

  for (const [factId, fact] of Object.entries(s.userProfileFacts)) {
    if (fact.userId !== userId) continue;
    delete s.userProfileFacts[factId];
    profileFacts += 1;
  }

  const beforeChangelog = s.userProfileChangelog.length;
  s.userProfileChangelog = s.userProfileChangelog.filter((entry) => entry.userId !== userId);
  profileChangelog = beforeChangelog - s.userProfileChangelog.length;

  for (const [sessionId, row] of Object.entries(s.contextSummaries)) {
    const session = s.sessions[sessionId];
    if (!row || session?.userId !== userId) continue;
    delete s.contextSummaries[sessionId];
    contextSummaries += 1;
  }

  const deleted = { preferences, events, profiles, profileFacts, profileChangelog, contextSummaries };
  // 审计落点统一经 adminAuditRepo（缝 2 收口）；id/ts 由 repo 生成，与原内联格式逐字节一致。
  // actor='user' 由本调用显式给出——audit() 门面只会落默认 'admin'，故这里直接调 repo。
  // void = 与门面一致的同步 fire-and-forget；上方删除态由随后的 store.save() 落盘。
  void adminAuditRepo.append({
    action: 'memory.forget_all',
    actor: 'user',
    target: userId,
    reason: 'user requested forget all memories',
    payload: deleted,
  });
  store.save();
  return deleted;
}

// ── Recall（简易 cosine top-K，服务端降级用） ──

function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface RecallResult {
  id: string;
  type: 'preference' | 'event';
  text: string;
  score: number;
}

export function recall(userId: string, characterId: string, mode: 'main' | 'if', queryEmbedding: number[], topK: number = 5): RecallResult[] {
  const results: RecallResult[] = [];
  const modeFilter = mode === 'if' ? ['main', 'if'] : ['main'];

  for (const r of Object.values(store.state().userPreferences)) {
    if (r.userId !== userId || r.tombstone) continue;
    if (r.characterId !== characterId) continue;
    if (r.branchId) continue;
    if (!modeFilter.includes(r.mode)) continue;
    if (!r.embedding) continue;
    const score = cosine(queryEmbedding, r.embedding);
    results.push({ id: r.id, type: 'preference', text: r.text, score });
  }

  for (const r of Object.values(store.state().userEvents)) {
    if (r.userId !== userId || r.tombstone) continue;
    if (r.characterId !== characterId) continue;
    if (r.branchId) continue;
    if (!modeFilter.includes(r.mode)) continue;
    if (!r.embedding) continue;
    const score = cosine(queryEmbedding, r.embedding);
    results.push({ id: r.id, type: 'event', text: `${r.date}: ${r.text}`, score });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topK);
}

export function getMemoryProfile(userId: string): {
  snapshot: { markdown: string; updatedAt: string } | null;
  facts: Array<Omit<UserProfileFactRow, 'userId'>>;
} {
  const s = store.state();

  // 偏好/事件已收敛到 userPreferences / userEvents（有 consolidation 浓缩）。
  // 这里的「画像线索」只浓缩 relationship 这类专表未覆盖的 fact：
  // 按归一文本合并同义条目（confidence 取大、保留最新），再按每类上限收口，
  // 避免画像线索随重复写入无界堆叠。历史遗留的 preference/event fact 不再展示。
  const byNormalized = new Map<string, UserProfileFactRow>();
  for (const fact of Object.values(s.userProfileFacts)) {
    if (fact.userId !== userId || fact.status !== 'active') continue;
    if (fact.type !== 'relationship') continue;
    const key = `${fact.characterId}\u0000${normalizePreferenceText(fact.text)}`;
    const prev = byNormalized.get(key);
    if (!prev) {
      byNormalized.set(key, fact);
      continue;
    }
    byNormalized.set(key, {
      ...prev,
      confidence: Math.max(prev.confidence, fact.confidence),
      updatedAt: newerTimestamp(prev.updatedAt, fact.updatedAt),
    });
  }

  const facts = [...byNormalized.values()]
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .slice(0, CATEGORY_LIMITS.relationship)
    .map((fact) => ({
      id: fact.id,
      characterId: fact.characterId,
      scope: fact.scope,
      type: fact.type,
      text: fact.text,
      confidence: fact.confidence,
      status: fact.status,
      source: fact.source,
      sourceSessionId: fact.sourceSessionId,
      updatedAt: fact.updatedAt,
    }));

  return {
    snapshot: s.userProfiles[userId] ?? null,
    facts,
  };
}
