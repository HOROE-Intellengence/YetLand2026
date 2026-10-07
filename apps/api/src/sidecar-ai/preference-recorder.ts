// 偏好记录 AI — 每 5 次用户输入触发一次
// 提取用户偏好、事件、关系状态，写入用户画像
import { randomUUID } from 'node:crypto';
import type { PreferenceRecordResult, SidecarResult } from './types';
import { getPrompt } from './prompts';
import { sidecarCallWithSchema } from './client';
import { PreferenceRecordResultSchema } from '@yelan/shared';
import { store } from '../store/persistence';
import { normalizePreferenceCategory, upsertPreferenceRow } from '../services/memories';
import { memoryScopeKey, pinnedUserIdentity, type MemoryScope } from '../services/memory-scope';

// 计数器：userId → 用户输入次数
const inputCounters: Record<string, number> = {};

export function bumpInputCounter(userId: string): number {
  if (!inputCounters[userId]) inputCounters[userId] = 0;
  inputCounters[userId]! += 1;
  return inputCounters[userId]!;
}

export function shouldRecordPreference(userId: string): boolean {
  return (inputCounters[userId] ?? 0) % 5 === 0;
}

const profileQueues = new Map<string, Promise<unknown>>();

export function recordPreference(
  userId: string, characterId: string, recentConversation: string,
  sourceSessionId?: string, scope?: MemoryScope,
): Promise<SidecarResult<PreferenceRecordResult>> {
  const key = scope ? memoryScopeKey(userId, characterId, scope) : `legacy:${userId}`;
  const work = (profileQueues.get(key) ?? Promise.resolve()).catch(() => {}).then(() =>
    extractPreference(userId, characterId, recentConversation, sourceSessionId, scope),
  );
  profileQueues.set(key, work);
  void work.finally(() => { if (profileQueues.get(key) === work) profileQueues.delete(key); }).catch(() => {});
  return work;
}

async function extractPreference(
  userId: string,
  characterId: string,
  recentConversation: string,
  sourceSessionId?: string,
  scope?: MemoryScope,
): Promise<SidecarResult<PreferenceRecordResult>> {
  const scoped = Boolean(scope);
  scope ??= { mode: 'main' };
  const profileKey = memoryScopeKey(userId, characterId, scope);
  const prompt = getPrompt('preferenceRecorder');
  const existingProfile = scoped ? getUserProfile(userId, characterId, scope) : getUserProfile(userId);
  const conversation = scoped ? recentConversation : recentConversation.slice(0, 3000);
  const userContent = existingProfile?.trim()
    ? `[已有画像]\n${existingProfile.slice(0, 2000)}\n\n[最近对话]\n${conversation}`
    : conversation;

  const result = await sidecarCallWithSchema(prompt, userContent, PreferenceRecordResultSchema, {
    taskKey: 'preferenceRecorder', ...(scoped ? { timeoutMs: 30000, maxTokens: 2048 } : {}),
  });

  if (result.ok && result.data) {
    const s = store.state();
    const now = new Date().toISOString();
    const extractedPreferences = result.data.preferences
      .map((pref) => {
        if (typeof pref === 'string') return { text: pref.trim().slice(0, 2000), category: undefined };
        return { text: pref.text.trim().slice(0, 2000), category: normalizePreferenceCategory(pref.category) };
      })
      .filter((pref) => pref.text);

    // 当前注入主 AI 的画像快照：替换而不是堆叠；保留用户显式设置的称呼。
    const profiles = scoped ? (s.scopedMemoryProfiles ??= {}) : s.userProfiles;
    profiles[scoped ? profileKey : userId] = {
      markdown: preservePinnedProfileLines(existingProfile, result.data.summary),
      updatedAt: now,
    };
    s.userProfileChangelog.push({
      mode: scope.mode, branchId: scope.branchId, sourceApp: scope.sourceApp,
      id: `pflog_${randomUUID().slice(0, 8)}`,
      userId,
      characterId,
      sourceSessionId,
      summary: result.data.summary,
      preferences: extractedPreferences.map((pref) => pref.text),
      events: result.data.events,
      relationshipState: result.data.relationshipState,
      createdAt: now,
    });

    // 将 preferences/events 写入记忆存储。
    // 真理源唯一化：偏好只写 userPreferences（已有 consolidation 去重/衰减/上限），
    // 事件只写 userEvents；不再向 userProfileFacts 双写，避免画像线索无界堆叠。
    // userProfileFacts 仅保留 relationship 这类 preferences/events 表未覆盖的类型。
    if (extractedPreferences.length > 0 || result.data.events.length > 0) {
      for (const pref of extractedPreferences) {
        upsertPreferenceRow(userId, {
          characterId,
          branchId: scope.branchId,
          mode: scope.mode,
          text: pref.text,
          category: pref.category,
        }, now);
      }

      for (const event of result.data.events) {
        const cleanText = event.text.trim().slice(0, 2000);
        if (!cleanText) continue;
        const id = `evt_${randomUUID().slice(0, 8)}`;
        s.userEvents[id] = {
          id,
          userId,
          characterId,
          branchId: scope.branchId,
          mode: scope.mode,
          date: event.date,
          text: cleanText,
          emotion: event.emotion,
          updatedAt: now,
          tombstone: false,
        };
      }
    }

    const relationship = result.data.relationshipState?.trim();
    if (relationship) {
      upsertProfileFact({
        userId,
        characterId,
        mode: scope.mode, branchId: scope.branchId,
        sourceSessionId,
        type: 'relationship',
        text: relationship.slice(0, 500),
        confidence: 0.65,
        updatedAt: now,
      });
    }

    store.save();
  }

  return result;
}

/** 获取用户画像 Markdown */
export function getUserProfile(userId: string, characterId?: string, scope: MemoryScope = { mode: 'main' }): string {
  const row = store.state().userProfiles[userId];
  if (characterId) {
    const scoped = store.state().scopedMemoryProfiles?.[memoryScopeKey(userId, characterId, scope)]?.markdown;
    // Legacy global summaries may contain another character's relationship. Only
    // explicitly pinned identity is safe to carry into a scoped prompt.
    return [pinnedUserIdentity(row?.markdown), scoped].filter(Boolean).join('\n');
  }
  return row?.markdown ?? '';
}

function preservePinnedProfileLines(existingProfile: string | undefined, nextSummary: string): string {
  const pinned = (existingProfile ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- 用户称呼名：') || line.startsWith('- User display name:'));
  if (pinned.length === 0) return nextSummary;

  const body = nextSummary.trim();
  const missing = pinned.filter((line) => !body.includes(line));
  return [...missing, body].filter(Boolean).join('\n').trim();
}

function upsertProfileFact(args: {
  mode?: 'main' | 'if';
  branchId?: string;
  userId: string;
  characterId: string;
  sourceSessionId?: string;
  type: 'preference' | 'event' | 'relationship';
  text: string;
  confidence: number;
  updatedAt: string;
}): void {
  const s = store.state();
  const text = args.text.trim().slice(0, 500);
  if (!text) return;

  const existing = Object.values(s.userProfileFacts).find((fact) =>
    fact.userId === args.userId
    && fact.characterId === args.characterId
    && (fact.mode ?? 'main') === (args.mode ?? 'main') && fact.branchId === args.branchId
    && fact.scope === 'character'
    && fact.type === args.type
    && fact.text === text
    && fact.status !== 'rejected',
  );

  if (existing) {
    existing.confidence = Math.max(existing.confidence, args.confidence);
    existing.status = 'active';
    existing.sourceSessionId = args.sourceSessionId ?? existing.sourceSessionId;
    existing.updatedAt = args.updatedAt;
    return;
  }

  const id = `pf_${randomUUID().slice(0, 8)}`;
  s.userProfileFacts[id] = {
    mode: args.mode, branchId: args.branchId,
    id,
    userId: args.userId,
    characterId: args.characterId,
    scope: 'character',
    type: args.type,
    text,
    confidence: args.confidence,
    status: 'active',
    source: 'sidecar',
    sourceSessionId: args.sourceSessionId,
    updatedAt: args.updatedAt,
  };
}
