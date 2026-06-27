import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import {
  listEvents,
  listPreferences,
  recall,
  deleteAllMemories,
  consolidatePreferences,
  getMemoryProfile,
  shouldConsolidatePreferences,
  upsertEvents,
  upsertPreferences,
} from './memories';

function seedUser(id = 'u1') {
  const token = `tok_${id}`;
  store.state().users[id] = {
    id,
    phone: `1380000${id}`,
    token,
    ageVerified: true,
    narrativeBoundary: 2,
    ifUnlocked: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    candle: 100,
    registerGrant: 100,
    conversationRounds: 0,
  };
  store.state().tokenIndex[token] = id;
}

describe('memory service', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('upserts preferences and events for a user', () => {
    const prefs = upsertPreferences('u1', [
      { characterId: 'shen', mode: 'main', text: '不喜欢被叫宝贝', embedding: [1, 0], weight: 2 },
    ]);
    const events = upsertEvents('u1', [
      { characterId: 'shen', mode: 'main', date: '2026-05-10', text: '提到怕打雷', embedding: [0, 1] },
    ]);

    expect(prefs).toHaveLength(1);
    expect(events).toHaveLength(1);
    expect(listPreferences('u1')).toHaveLength(1);
    expect(listEvents('u1')).toHaveLength(1);
  });

  it('keeps IF memories out of main recall but includes them in IF recall', () => {
    upsertPreferences('u1', [
      { characterId: 'shen', mode: 'main', text: '主线偏好', embedding: [1, 0], weight: 1 },
      { characterId: 'shen', mode: 'if', text: 'IF 事件', embedding: [1, 0], weight: 1 },
    ]);

    const main = recall('u1', 'shen', 'main', [1, 0], 10).map((r) => r.text);
    const ifMode = recall('u1', 'shen', 'if', [1, 0], 10).map((r) => r.text);

    expect(main).toEqual(['主线偏好']);
    expect(ifMode).toContain('主线偏好');
    expect(ifMode).toContain('IF 事件');
  });

  it('keeps recall scoped to the requested character', () => {
    upsertPreferences('u1', [
      { characterId: 'shen', mode: 'main', text: '沈线偏好', embedding: [1, 0], weight: 1 },
      { characterId: 'jiang', mode: 'main', text: '江线偏好', embedding: [1, 0], weight: 1 },
    ]);

    expect(recall('u1', 'shen', 'main', [1, 0], 10).map((r) => r.text)).toEqual(['沈线偏好']);
  });

  it('returns only active relationship profile facts without leaking userId', () => {
    store.state().userProfiles.u1 = { markdown: '当前画像', updatedAt: 'now' };
    store.state().userProfileFacts.f1 = {
      id: 'f1',
      userId: 'u1',
      characterId: 'shen',
      scope: 'character',
      type: 'relationship',
      text: '对沈砚之更信任',
      confidence: 0.8,
      status: 'active',
      source: 'sidecar',
      updatedAt: 'now',
    };
    store.state().userProfileFacts.f2 = {
      id: 'f2',
      userId: 'u1',
      characterId: 'shen',
      scope: 'character',
      type: 'relationship',
      text: '旧关系',
      confidence: 0.4,
      status: 'rejected',
      source: 'sidecar',
      updatedAt: 'now',
    };
    // 偏好 fact 不再进入画像线索（已收敛到 userPreferences）。
    store.state().userProfileFacts.f3 = {
      id: 'f3',
      userId: 'u1',
      characterId: 'shen',
      scope: 'character',
      type: 'preference',
      text: '不喜欢被叫宝贝',
      confidence: 0.9,
      status: 'active',
      source: 'sidecar',
      updatedAt: 'now',
    };

    const profile = getMemoryProfile('u1');

    expect(profile.snapshot?.markdown).toBe('当前画像');
    expect(profile.facts).toHaveLength(1);
    expect(profile.facts[0]).not.toHaveProperty('userId');
    expect(profile.facts[0]?.type).toBe('relationship');
    expect(profile.facts[0]?.text).toBe('对沈砚之更信任');
  });

  it('collapses synonymous profile facts so the clue list does not grow unbounded', () => {
    const s = store.state();
    // 同义 relationship fact 反复写入（措辞略有差异），归一后应合并为 1 条。
    const wordings = ['对沈砚之更信任', '对沈砚之，更信任。', '对沈砚之更信任！'];
    wordings.forEach((text, i) => {
      s.userProfileFacts[`rel${i}`] = {
        id: `rel${i}`,
        userId: 'u1',
        characterId: 'shen',
        scope: 'character',
        type: 'relationship',
        text,
        confidence: 0.5 + i * 0.1,
        status: 'active',
        source: 'sidecar',
        updatedAt: `2026-0${i + 1}-01T00:00:00.000Z`,
      };
    });

    const facts = getMemoryProfile('u1').facts;

    expect(facts).toHaveLength(1);
    // confidence 取最大、保留最新时间戳。
    expect(facts[0]?.confidence).toBeCloseTo(0.7);
    expect(facts[0]?.updatedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('keeps synonymous preferences to a single active row without stacking profile facts', () => {
    // 模拟同义偏好反复写入 N 次：upsert 按归一文本合并，画像线索不再堆叠。
    for (let i = 0; i < 5; i += 1) {
      upsertPreferences('u1', [
        { characterId: 'shen', mode: 'main', text: `不喜欢被叫宝贝${'！'.repeat(i)}`, category: 'boundary' },
      ]);
    }

    expect(listPreferences('u1')).toHaveLength(1);
    // 偏好不再双写到 userProfileFacts → 画像线索为空，不随写入次数增长。
    expect(getMemoryProfile('u1').facts).toHaveLength(0);
  });

  it('returns tombstones in incremental sync after deleting all memories', () => {
    upsertPreferences('u1', [
      { characterId: 'shen', mode: 'main', text: '主线偏好', embedding: [1, 0], weight: 1 },
    ]);
    upsertEvents('u1', [
      { characterId: 'shen', mode: 'main', date: '2026-05-10', text: '主线事件', embedding: [0, 1] },
    ]);

    const since = '2000-01-01T00:00:00.000Z';
    expect(deleteAllMemories('u1')).toEqual({
      preferences: 1,
      events: 1,
      profiles: 0,
      profileFacts: 0,
      profileChangelog: 0,
      contextSummaries: 0,
    });
    expect(listPreferences('u1')).toHaveLength(0);
    expect(listEvents('u1')).toHaveLength(0);
    expect(listPreferences('u1', since)[0]?.tombstone).toBe(true);
    expect(listEvents('u1', since)[0]?.tombstone).toBe(true);
  });

  it('forget all also clears sidecar profile and owned context summaries', () => {
    store.state().sessions.s1 = {
      id: 's1',
      userId: 'u1',
      characterId: 'shen',
      mode: 'main',
      round: 0,
      prevStage: 'daily',
      createdAt: 'now',
      updatedAt: 'now',
    };
    store.state().sessions.s2 = {
      id: 's2',
      userId: 'u2',
      characterId: 'shen',
      mode: 'main',
      round: 0,
      prevStage: 'daily',
      createdAt: 'now',
      updatedAt: 'now',
    };
    store.state().userProfiles.u1 = { markdown: '画像', updatedAt: 'now' };
    store.state().userProfileFacts.f1 = {
      id: 'f1',
      userId: 'u1',
      characterId: 'shen',
      scope: 'character',
      type: 'preference',
      text: '偏好',
      confidence: 0.8,
      status: 'active',
      source: 'sidecar',
      sourceSessionId: 's1',
      updatedAt: 'now',
    };
    store.state().userProfileFacts.f2 = {
      id: 'f2',
      userId: 'u2',
      characterId: 'shen',
      scope: 'character',
      type: 'preference',
      text: '其他用户偏好',
      confidence: 0.8,
      status: 'active',
      source: 'sidecar',
      sourceSessionId: 's2',
      updatedAt: 'now',
    };
    store.state().userProfileChangelog.push(
      { id: 'log1', userId: 'u1', characterId: 'shen', sourceSessionId: 's1', summary: '画像', preferences: [], events: [], createdAt: 'now' },
      { id: 'log2', userId: 'u2', characterId: 'shen', sourceSessionId: 's2', summary: '画像', preferences: [], events: [], createdAt: 'now' },
    );
    store.state().contextSummaries.s1 = { summary: 'u1 摘要', updatedAt: 'now', compressedUntilMessageId: 'm1' };
    store.state().contextSummaries.s2 = { summary: 'u2 摘要', updatedAt: 'now', compressedUntilMessageId: 'm2' };

    expect(deleteAllMemories('u1')).toEqual({
      preferences: 0,
      events: 0,
      profiles: 1,
      profileFacts: 1,
      profileChangelog: 1,
      contextSummaries: 1,
    });

    expect(store.state().userProfiles.u1).toBeUndefined();
    expect(store.state().userProfileFacts.f1).toBeUndefined();
    expect(store.state().userProfileFacts.f2?.status).toBe('active');
    expect(store.state().userProfileChangelog.map((entry) => entry.id)).toEqual(['log2']);
    expect(store.state().contextSummaries.s1).toBeUndefined();
    expect(store.state().contextSummaries.s2?.summary).toBe('u2 摘要');
    expect(store.state().adminAudit.at(-1)).toMatchObject({
      action: 'memory.forget_all',
      actor: 'user',
      target: 'u1',
      payload: { preferences: 0, events: 0, profiles: 1, profileFacts: 1, profileChangelog: 1, contextSummaries: 1 },
    });
  });

  it('upserts duplicate preferences by normalized text instead of appending rows', () => {
    const first = upsertPreferences('u1', [
      { characterId: 'shen', mode: 'main', text: 'Do not call me babe!', category: 'boundary' },
    ]);
    const second = upsertPreferences('u1', [
      { characterId: 'shen', mode: 'main', text: 'do not call me babe', category: 'preference' },
    ]);

    const active = listPreferences('u1');

    expect(first[0]?.id).toBe(second[0]?.id);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ category: 'boundary', weight: 2, tombstone: false });
  });

  it('consolidates stored duplicate preferences into tombstones for incremental sync', () => {
    const s = store.state();
    s.userPreferences.p1 = {
      id: 'p1',
      userId: 'u1',
      characterId: 'shen',
      mode: 'main',
      text: 'likes quiet rooms',
      category: 'preference',
      weight: 2,
      lastUsedAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      tombstone: false,
    };
    s.userPreferences.p2 = {
      id: 'p2',
      userId: 'u1',
      characterId: 'shen',
      mode: 'main',
      text: 'Likes quiet rooms!',
      category: 'other',
      weight: 3,
      lastUsedAt: '2026-02-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
      tombstone: false,
    };

    const stats = consolidatePreferences('u1', '2026-06-01T00:00:00.000Z');
    const active = listPreferences('u1');
    const incremental = listPreferences('u1', '2026-05-01T00:00:00.000Z');

    expect(stats).toMatchObject({ activeBefore: 2, activeAfter: 1, merged: 1, tombstoned: 1 });
    expect(active).toHaveLength(1);
    expect(active[0]?.weight).toBe(5);
    expect(incremental.some((row) => row.id === 'p1' && row.tombstone)).toBe(true);
  });

  it('does not decay address or boundary preferences while pruning stale low-value rows', () => {
    const base = {
      userId: 'u1',
      characterId: 'shen',
      mode: 'main' as const,
      weight: 1,
      lastUsedAt: '2025-01-01T00:00:00.000Z',
      updatedAt: '2025-01-01T00:00:00.000Z',
      tombstone: false,
    };
    store.state().userPreferences.address = { ...base, id: 'address', text: 'call user Lin', category: 'address' };
    store.state().userPreferences.boundary = { ...base, id: 'boundary', text: 'avoid pet names', category: 'boundary' };
    store.state().userPreferences.other = { ...base, id: 'other', text: 'once liked a blue cup', category: 'other' };

    consolidatePreferences('u1', '2026-06-01T00:00:00.000Z');

    expect(store.state().userPreferences.address?.tombstone).toBe(false);
    expect(store.state().userPreferences.boundary?.tombstone).toBe(false);
    expect(store.state().userPreferences.other?.tombstone).toBe(true);
  });

  it('prunes profile changelog to the latest retained entries', () => {
    for (let i = 0; i < 55; i += 1) {
      store.state().userProfileChangelog.push({
        id: `log${i}`,
        userId: 'u1',
        characterId: 'shen',
        summary: `summary ${i}`,
        preferences: [],
        events: [],
        createdAt: new Date(Date.UTC(2026, 0, i + 1)).toISOString(),
      });
    }

    const stats = consolidatePreferences('u1', '2026-06-01T00:00:00.000Z');

    expect(stats.changelogPruned).toBe(5);
    expect(store.state().userProfileChangelog.filter((entry) => entry.userId === 'u1')).toHaveLength(50);
    expect(store.state().userProfileChangelog.some((entry) => entry.id === 'log0')).toBe(false);
    expect(store.state().userProfileChangelog.some((entry) => entry.id === 'log54')).toBe(true);
  });

  it('uses active count or persisted conversation rounds to trigger consolidation', () => {
    seedUser('u1');
    store.state().users.u1!.conversationRounds = 19;
    upsertPreferences('u1', [{ characterId: 'shen', mode: 'main', text: 'likes direct answers' }]);

    expect(shouldConsolidatePreferences('u1')).toBe(false);

    store.state().users.u1!.conversationRounds = 20;
    expect(shouldConsolidatePreferences('u1')).toBe(true);
  });
});
