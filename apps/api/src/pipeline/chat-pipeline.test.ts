import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { clearFlagCache } from '../config/feature-flags';
import { recordTemperature, getTemperatureLog } from '../sidecar-ai/atmosphere-judge';
import { resolveIfUnlockFromText } from '../services/if-unlock';
import { policyService, clearPolicyCache } from '../services/policy';
import { buildSidecarBlock, classifySidecarFailure, ensureChatSession, persistUserMessage, resolveTemperature } from './chat-pipeline';

function seedUser(id = 'usr_test') {
  const s = store.state();
  const token = `tok_${id}`;
  s.users[id] = {
    id,
    phone: '13800000000',
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
  s.phoneIndex['13800000000'] = id;
  return id;
}

describe('chat pipeline round counters', () => {
  beforeEach(() => {
    store.__resetForTests();
    clearFlagCache();
  });

  it('increments cached conversationRounds when persisting user messages', () => {
    const userId = seedUser();
    ensureChatSession({ id: 'session-1', userId, characterId: 'char-1' });

    persistUserMessage('session-1', '第一句');
    persistUserMessage('session-1', '第二句');

    expect(store.state().users[userId]?.conversationRounds).toBe(2);
  });

  it('activates IF without writing a forced temperature record', () => {
    const userId = seedUser();
    ensureChatSession({ id: 'session-1', userId, characterId: 'char-1' });

    const result = resolveIfUnlockFromText(userId, 'session-1', 'YELAN-MOON');

    expect(result).toEqual({ matched: true, ifActive: true });
    expect(getTemperatureLog('session-1')).toEqual([]);
  });

  it('keeps the previous temperature when atmosphere sidecar is unavailable', async () => {
    const prev = process.env.FEATURE_TEMP_V2;
    process.env.FEATURE_TEMP_V2 = 'off';
    clearFlagCache();
    try {
      const now = new Date().toISOString();
      store.state().llmApiInventory = {
        entries: {
          disabled: {
            id: 'disabled',
            name: 'Disabled',
            protocol: 'openai-compatible',
            baseUrl: 'https://example.test/v1',
            model: 'test-model',
            apiKey: '',
            enabled: false,
            createdAt: now,
            updatedAt: now,
          },
        },
        mainApiId: null,
        sidecarApiId: 'disabled',
        sidecarTaskApiIds: {},
      };
      recordTemperature('session-1', 4);
      const temperature = await resolveTemperature({
        sessionId: 'session-1',
        characterName: '测试角色',
        characterDescription: '标准',
        styleTags: [],
        userInput: '我账号登不上',
        boundary: 3,
        stage: 'daily',
        round: 3,
        ifUnlock: { matched: false, ifActive: true },
      });

      expect(temperature).toBe(4);
      expect(getTemperatureLog('session-1').at(-1)).toBe(4);
    } finally {
      if (prev === undefined) delete process.env.FEATURE_TEMP_V2;
      else process.env.FEATURE_TEMP_V2 = prev;
      clearFlagCache();
    }
  });

  it('sync mode (TEMPERATURE_OPTIMISTIC=false) blocks on judge and still degrades to previous temp when sidecar is down', async () => {
    clearPolicyCache();
    policyService.set('TEMPERATURE_OPTIMISTIC', false, 'test');
    try {
      recordTemperature('session-sync', 2);
      const temperature = await resolveTemperature({
        sessionId: 'session-sync',
        characterName: '测试角色',
        characterDescription: '标准',
        styleTags: [],
        userInput: '我账号登不上',
        boundary: 3,
        stage: 'daily',
        round: 3,
        ifUnlock: { matched: false, ifActive: false },
      });

      // 同步模式 + 侧袋不可用 → judge 返回 null → 沿用上一轮温度 2 并记录
      expect(temperature).toBe(2);
      expect(getTemperatureLog('session-sync').at(-1)).toBe(2);
    } finally {
      clearPolicyCache();
    }
  });

  it('classifies sidecar degradation reasons for logs', () => {
    expect(classifySidecarFailure('no sidecar API key configured')).toBe('no key');
    expect(classifySidecarFailure('sidecar timeout after 5000ms')).toBe('timeout');
    expect(classifySidecarFailure('schema validation: Required')).toBe('schema invalid');
  });
});

describe('buildSidecarBlock temperature contract', () => {
  it('always carries the current temperature and the temperature contract line', () => {
    const block = buildSidecarBlock(3, undefined, undefined);
    expect(block).toContain('[当前温度：3]');
    // 温度契约：温度=当前情绪速度（非历史高度）、边界=可写上限（非升温指令）
    expect(block).toContain('温度是本轮当前情绪速度');
    expect(block).toContain('边界是内容可写上限');
  });

  it('gives behavior guidance for every temperature level 1-5, including the middle 3', () => {
    for (let t = 1; t <= 5; t++) {
      expect(buildSidecarBlock(t, undefined, undefined)).toContain('[温度演法：');
    }
    // 中间档不再无指引
    expect(buildSidecarBlock(3, undefined, undefined)).toContain('暧昧升温');
    expect(buildSidecarBlock(1, undefined, undefined)).toContain('冷淡疏离');
    expect(buildSidecarBlock(5, undefined, undefined)).toContain('亲密无间');
  });

  it('clamps out-of-range temperatures to the nearest level', () => {
    expect(buildSidecarBlock(0, undefined, undefined)).toContain('冷淡疏离');
    expect(buildSidecarBlock(9, undefined, undefined)).toContain('亲密无间');
  });

  it('still appends profile and summary when provided', () => {
    const block = buildSidecarBlock(2, '画像内容', '概要内容');
    expect(block).toContain('[用户画像]\n画像内容');
    expect(block).toContain('[旧对话概要]\n概要内容');
  });
});
