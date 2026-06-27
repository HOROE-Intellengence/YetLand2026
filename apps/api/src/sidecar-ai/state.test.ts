import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../store/persistence';
import { judgeAtmosphere, getCurrentTemperature, getTemperatureLog } from './atmosphere-judge';
import { getUserProfile, recordPreference } from './preference-recorder';
import {
  getCompressedUntilMessageId,
  getSummary,
  getUncompressedExpiredMessages,
  markSummaryCompressedUntil,
  setSummary,
} from './context-compressor';
import { fallbackQuotaEnding } from './quota-ending';

describe('sidecar state persistence helpers', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('does not hard-lock code-match temperature before atmosphere judgment', async () => {
    const now = new Date().toISOString();
    store.state().llmApiInventory = {
      entries: {
        sidecar: {
          id: 'sidecar',
          name: 'Sidecar',
          protocol: 'openai-compatible',
          baseUrl: 'https://example.test/v1',
          model: 'test-model',
          apiKey: 'sidecar-key-1234567890',
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      mainApiId: null,
      sidecarApiId: 'sidecar',
      sidecarTaskApiIds: {},
    };
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"temperature":2}' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const result = await judgeAtmosphere(
      {
        characterName: '沈砚之',
        characterPersonality: '克制',
        boundary: 3,
        stage: 'daily',
        round: 1,
        ifActive: true,
        recentTemperatures: [],
        recentConversation: '',
        userInput: 'YELAN-MOON',
        codeMatched: true,
      },
      'session-1',
    );

    expect(result).toMatchObject({ ok: true, data: { temperature: 2 } });
    expect(bodies[0]).toContain('本轮命中 IF 暗号');
    expect(bodies[0]).toContain('当前内容边界：B3');
    expect(getCurrentTemperature('session-1')).toBe(2);
    expect(getTemperatureLog('session-1')).toEqual([2]);
    expect((store.state() as any).temperatureLogs['session-1'].values).toEqual([2]);
    vi.unstubAllGlobals();
  });

  it('reads user profile from persisted state', () => {
    store.state().userProfiles.u1 = { markdown: '## 画像\n不喜欢被叫宝贝', updatedAt: 'now' };

    expect(getUserProfile('u1')).toContain('不喜欢被叫宝贝');
  });

  it('records a rolling profile snapshot plus structured facts and changelog', async () => {
    const now = new Date().toISOString();
    store.state().userProfiles.u1 = { markdown: '旧画像', updatedAt: now };
    store.state().llmApiInventory = {
      entries: {
        sidecar: {
          id: 'sidecar',
          name: 'Sidecar',
          protocol: 'openai-compatible',
          baseUrl: 'https://example.test/v1',
          model: 'test-model',
          apiKey: 'sidecar-key-1234567890',
          enabled: true,
          createdAt: now,
          updatedAt: now,
        },
      },
      mainApiId: null,
      sidecarApiId: 'sidecar',
      sidecarTaskApiIds: { preferenceRecorder: 'sidecar' },
    };
    const bodies: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ''));
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          preferences: [{ text: '不喜欢被叫宝贝', category: 'boundary' }],
          events: [{ date: '今天', text: '提到怕打雷', emotion: '紧张' }],
          relationshipState: '对沈砚之更信任',
          summary: '当前画像',
        }) } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }));

    const result = await recordPreference('u1', 'shen', 'user: 最近对话', 's1');

    expect(result.ok).toBe(true);
    expect(JSON.parse(bodies[0]!).messages[1].content).toContain('[已有画像]');
    expect(getUserProfile('u1')).toBe('当前画像');
    expect(getUserProfile('u1')).not.toContain('旧画像');
    expect(store.state().userProfileChangelog).toHaveLength(1);
    // 偏好/事件不再双写到 userProfileFacts；只有 relationship 落到 fact 表。
    expect(Object.values(store.state().userProfileFacts).map((fact) => fact.type).sort()).toEqual([
      'relationship',
    ]);
    expect(Object.values(store.state().userProfileFacts).every((fact) => fact.sourceSessionId === 's1')).toBe(true);
    // 偏好落到 userPreferences、事件落到 userEvents，作为唯一真理源。
    expect(Object.values(store.state().userPreferences)[0]?.category).toBe('boundary');
    expect(Object.values(store.state().userEvents)[0]?.text).toBe('提到怕打雷');
    vi.unstubAllGlobals();
  });

  it('persists rolling context summaries with a compression cursor', () => {
    setSummary('s1', '第一段概要', 'm1');
    setSummary('s1', '整合后的概要', 'm2');

    expect(getSummary('s1')).toBe('整合后的概要');
    expect(getCompressedUntilMessageId('s1')).toBe('m2');
    expect(store.state().contextSummaries.s1?.summary).not.toContain('---');
  });

  it('can backfill a compression cursor without changing an existing summary', () => {
    setSummary('s1', '旧概要');
    markSummaryCompressedUntil('s1', 'm9');

    expect(getSummary('s1')).toBe('旧概要');
    expect(getCompressedUntilMessageId('s1')).toBe('m9');
  });

  it('selects only expired messages after the compression cursor', () => {
    const expired = [
      { id: 'm1', role: 'user', content: '一' },
      { id: 'm2', role: 'assistant', content: '二' },
      { id: 'm3', role: 'user', content: '三' },
    ];

    expect(getUncompressedExpiredMessages(expired, 'm2').map((m) => m.id)).toEqual(['m3']);
    expect(getUncompressedExpiredMessages(expired, undefined).map((m) => m.id)).toEqual(['m1', 'm2', 'm3']);
  });

  it('always provides a quota-ending fallback instruction', () => {
    expect(fallbackQuotaEnding().closingInstruction).toContain('不要提到任何系统限制');
  });
});
