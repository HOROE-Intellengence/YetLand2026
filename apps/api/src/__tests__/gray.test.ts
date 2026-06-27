// 灰测回归测试 — verify:gray 核心
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { clearPolicyCache, policyService } from '../services/policy';
import { mockEventsRoute } from '../routes/events';
import { adminQuotaRoute } from '../routes/admin/quota';
import { adminCostsRoute } from '../routes/admin/costs';
import { adminSeedRoute } from '../routes/admin/seed';
import { adminConfigRoute } from '../routes/admin/config';
import { mockMeRoute } from '../routes/me';
import { mockChatRoute } from '../routes/chat';
import { mockAchievementsRoute } from '../routes/achievements';
import { adminHealthRoute } from '../routes/admin/health';
import { adminDiagnosticsRoute } from '../routes/admin/diagnostics';
import { resetRouter } from '../llm/create-router';

// ── helpers ──

function adminHeaders(token = 'admin-dev-token') {
  return { Authorization: `Bearer ${token}` };
}

function userHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function makeUser() {
  const s = store.state();
  const id = 'usr_test01';
  const token = 'tok_test01';
  s.users[id] = {
    id,
    phone: '13800000001',
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
  s.phoneIndex['13800000001'] = id;
  store.save();
  return { id, token };
}

describe('gray regression suite', () => {
  beforeEach(() => {
    store.__resetForTests();
    resetRouter();
    clearPolicyCache();
  });

  // ─── P4: events 错误 schema → 400 JSON ───

  describe('POST /api/events validation', () => {
    it('returns 400 JSON on invalid body', async () => {
      const res = await mockEventsRoute.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ not_events: true }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { code?: string };
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('accepts valid telemetry batch', async () => {
      const res = await mockEventsRoute.request('/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ events: [{ name: 'user_open', ts: Date.now() }] }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { accepted?: boolean };
      expect(body.accepted).toBe(true);
    });
  });

  // ─── P4: admin 写接口 validation 失败 → 400 JSON ───

  describe('admin write endpoints validation', () => {
    it('POST /api/admin/quota/grant returns 400 on bad body', async () => {
      const res = await adminQuotaRoute.request('/grant', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ bad: true }),
      });
      expect(res.status).toBe(400);
      const body = await res.json() as { code?: string };
      expect(body.code).toBe('VALIDATION_ERROR');
    });

    it('POST /api/admin/quota/free-limit returns 400 on bad body', async () => {
      const res = await adminQuotaRoute.request('/free-limit', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ bad: true }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/admin/quota/exchange-toggle returns 400 on bad body', async () => {
      const res = await adminQuotaRoute.request('/exchange-toggle', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ bad: true }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/admin/seed returns 400 on missing reason', async () => {
      const res = await adminSeedRoute.request('/', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/admin/config/env returns 400 on bad body', async () => {
      const res = await adminConfigRoute.request('/env', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ bad: true }),
      });
      expect(res.status).toBe(400);
    });

    it('POST /api/admin/config/runtime returns 400 on bad body', async () => {
      const res = await adminConfigRoute.request('/runtime', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ bad: true }),
      });
      expect(res.status).toBe(400);
    });
  });

  // ─── P3: /api/me/achievements 读真实 store ───

  describe('GET /api/me/achievements', () => {
    it('reads from store.userAchievements', async () => {
      const { token } = makeUser();
      const s = store.state();
      s.userAchievements['usr_test01'] = [
        { achievementId: 'obsession', unlockedAt: '2026-01-01T00:00:00Z' },
      ];
      store.save();

      const res = await mockMeRoute.request('/achievements', {
        headers: userHeaders(token),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Array<{ achievementId: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]!.achievementId).toBe('obsession');
    });

    it('returns empty array for user with no achievements', async () => {
      const { token } = makeUser();
      const res = await mockMeRoute.request('/achievements', {
        headers: userHeaders(token),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual([]);
    });
  });

  // ─── P3: /api/admin/costs/cache-hit 返回 rate:null ───

  describe('GET /api/admin/costs/cache-hit', () => {
    it('returns rate:null with reason', async () => {
      const res = await adminCostsRoute.request('/cache-hit', {
        headers: adminHeaders(),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { rate: null; reason: string };
      expect(body.rate).toBeNull();
      expect(body.reason).toBe('not_available_in_mock');
    });
  });

  // ─── P5: SSE smoke — meta / chunk / done ───

  describe('POST /api/chat SSE smoke', () => {
    it('returns SSE stream with meta, chunk, done events', async () => {
      const { token } = makeUser();
      // 添加角色卡
      store.state().characters['test-char'] = {
        id: 'test-char',
        slug: 'test',
        name: '测试角色',
        rarity: 'free',
        priceCandle: 0,
        styleTags: [],
        promptCardKey: 'test',
        preludeCardId: null,
        boundaryDefault: 2,
        isActive: true,
        openingFirstVisit: '你好',
        openingReturnVisit: '又见面了',
        forbiddenPhrases: [],
        description: '测试角色',
        updatedAt: new Date().toISOString(),
      };
      store.save();

      const res = await mockChatRoute.request('/', {
        method: 'POST',
        headers: {
          ...userHeaders(token),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          characterId: 'test-char',
          sessionId: 'sess_test',
          round: 0,
          prevStage: 'daily',
          userBoundary: 2,
          text: '你好',
          history: [],
        }),
      });

      expect(res.status).toBe(200);

      const text = await res.text();
      expect(text).toContain('data:');
      expect(text).toContain('"kind":"meta"');
      expect(text).toContain('"kind":"chunk"');
      expect(text).toContain('"kind":"done"');
    });

    it('includes requestId in meta, chunk, and done events', async () => {
      const { token } = makeUser();
      store.state().characters['test-char'] = {
        id: 'test-char', slug: 'test', name: '测试角色', rarity: 'free',
        priceCandle: 0, styleTags: [], promptCardKey: 'test', preludeCardId: null,
        boundaryDefault: 2, isActive: true,
        openingFirstVisit: '你好', openingReturnVisit: '又见面了',
        forbiddenPhrases: [], description: '测试角色',
        updatedAt: new Date().toISOString(),
      };
      store.save();

      const res = await mockChatRoute.request('/', {
        method: 'POST',
        headers: {
          ...userHeaders(token),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          characterId: 'test-char', sessionId: 'sess_reqid', round: 0,
          prevStage: 'daily', userBoundary: 2, text: '你好', history: [],
        }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      // 提取所有 data: 行中的 requestId
      const ids = new Set<string>();
      for (const line of text.split('\n')) {
        if (!line.startsWith('data:')) continue;
        try {
          const parsed = JSON.parse(line.slice(5).trim());
          if (parsed.requestId) ids.add(parsed.requestId);
        } catch { /* skip */ }
      }
      expect(ids.size).toBe(1); // all events share same requestId
      const [id] = ids;
      expect(id).toBeTruthy();
    });

    it('includes tokenGuard and llmMode in meta event', async () => {
      const { token } = makeUser();
      store.state().characters['test-char'] = {
        id: 'test-char', slug: 'test', name: '测试角色', rarity: 'free',
        priceCandle: 0, styleTags: [], promptCardKey: 'test', preludeCardId: null,
        boundaryDefault: 2, isActive: true,
        openingFirstVisit: '你好', openingReturnVisit: '又见面了',
        forbiddenPhrases: [], description: '测试角色',
        updatedAt: new Date().toISOString(),
      };
      store.save();

      const res = await mockChatRoute.request('/', {
        method: 'POST',
        headers: {
          ...userHeaders(token),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          characterId: 'test-char', sessionId: 'sess_guard', round: 0,
          prevStage: 'daily', userBoundary: 2, text: '你好', history: [],
        }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      // 找 meta 事件
      const metaLine = text.split('\n').find((l) => l.startsWith('data:') && l.includes('"kind":"meta"'));
      expect(metaLine).toBeTruthy();
      const meta = JSON.parse(metaLine!.slice(5).trim());
      expect(meta.tokenGuard).toBe('ok');
      expect(meta.llmMode).toBeDefined();
    });
  });

  // ─── P3: FEATURE_REAL_LLM=off fallback ───

  describe('FEATURE_REAL_LLM=off', () => {
    it('still returns SSE stream when real LLM is disabled', async () => {
      process.env.FEATURE_REAL_LLM = 'off';
      const { token } = makeUser();
      store.state().characters['test-char'] = {
        id: 'test-char', slug: 'test', name: '测试角色', rarity: 'free',
        priceCandle: 0, styleTags: [], promptCardKey: 'test', preludeCardId: null,
        boundaryDefault: 2, isActive: true,
        openingFirstVisit: '你好', openingReturnVisit: '又见面了',
        forbiddenPhrases: [], description: '测试角色',
        updatedAt: new Date().toISOString(),
      };
      store.save();

      const res = await mockChatRoute.request('/', {
        method: 'POST',
        headers: {
          ...userHeaders(token),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          characterId: 'test-char', sessionId: 'sess_test2', round: 0,
          prevStage: 'daily', userBoundary: 2, text: '你好', history: [],
        }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"kind":"done"');

      delete process.env.FEATURE_REAL_LLM;
    });
  });

  // ─── P5: admin token 边界 ───

  describe('admin token boundary', () => {
    it('admin health route is reachable', async () => {
      const res = await adminHealthRoute.request('/');
      // health 路由本身无鉴权；鉴权由父路由 requireAdmin() 负责
      expect(res.status).toBe(200);
    });

    it('admin health returns server metadata', async () => {
      const res = await adminHealthRoute.request('/');
      expect(res.status).toBe(200);
      const body = await res.json() as { server?: { mode?: string }; sidecar?: { ready?: boolean } };
      expect(body.server).toBeDefined();
      expect(typeof body.sidecar?.ready).toBe('boolean');
    });
  });

  // ─── P5: cutoff / token limit ───

  describe('GET /api/admin/diagnostics LLM inventory', () => {
    it('accepts a ready API inventory provider as an available LLM key', async () => {
      const oldEnv = {
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        OPENAI_API_KEY: process.env.OPENAI_API_KEY,
        DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
        NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
      };
      try {
        process.env.ANTHROPIC_API_KEY = '';
        process.env.OPENAI_API_KEY = '';
        process.env.DEEPSEEK_API_KEY = '';
        process.env.NVIDIA_API_KEY = '';

        const now = new Date().toISOString();
        store.state().llmApiInventory = {
          entries: {
            'inv-nvidia': {
              id: 'inv-nvidia',
              name: 'Inventory NVIDIA',
              protocol: 'nvidia',
              baseUrl: 'https://integrate.api.nvidia.com/v1',
              model: 'z-ai/glm-5.1',
              apiKey: 'nvapi-test-key-1234567890',
              enabled: true,
              createdAt: now,
              updatedAt: now,
            },
          },
          mainApiId: 'inv-nvidia',
          sidecarApiId: 'inv-nvidia',
          sidecarTaskApiIds: {},
        };
        resetRouter();

        const res = await adminDiagnosticsRoute.request('/');
        expect(res.status).toBe(200);
        const body = await res.json() as { checks: Array<{ id: string; status: string; hint: string }> };
        const keyCheck = body.checks.find((check) => check.id === 'env-llm-key');
        const readyCheck = body.checks.find((check) => check.id === 'llm-ready');

        expect(keyCheck?.status).toBe('pass');
        expect(keyCheck?.hint).toContain('inv-nvidia');
        expect(readyCheck?.status).toBe('pass');
      } finally {
        for (const [key, value] of Object.entries(oldEnv)) {
          if (value === undefined) delete process.env[key];
          else process.env[key] = value;
        }
        resetRouter();
      }
    });
  });

  describe('token limit cutoff', () => {
    it('returns cutoff when quota exhausted', async () => {
      const { token } = makeUser();
      store.state().characters['test-char'] = {
        id: 'test-char', slug: 'test', name: '测试角色', rarity: 'free',
        priceCandle: 0, styleTags: [], promptCardKey: 'test', preludeCardId: null,
        boundaryDefault: 2, isActive: true,
        openingFirstVisit: '你好', openingReturnVisit: '又见面了',
        forbiddenPhrases: [], description: '测试角色',
        updatedAt: new Date().toISOString(),
      };
      // 消耗所有免费额度
      const date = new Date().toISOString().slice(0, 10);
      store.state().quota['usr_test01'] = {
        [date]: { date, freeUsed: 99, bonusUsed: 0, bonusLimit: 0 },
      };
      store.state().freeLimitOverride = 5;
      store.save();

      const res = await mockChatRoute.request('/', {
        method: 'POST',
        headers: {
          ...userHeaders(token),
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          characterId: 'test-char', sessionId: 'sess_cut', round: 0,
          prevStage: 'daily', userBoundary: 2, text: '你好', history: [],
        }),
      });

      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain('"kind":"cutoff"');
      expect(text).toMatch(/"requestId"\s*:\s*"[^"]+"/);
    });
  });

  // ─── P5: health 基础行为（已在 admin token boundary 中覆盖） ───

  // ─── P3: /api/achievements/me 对齐 ───
  describe('GET /api/achievements/me', () => {
    it('returns achievements for authenticated user', async () => {
      const { token } = makeUser();
      store.state().userAchievements['usr_test01'] = [
        { achievementId: 'obsession', unlockedAt: '2026-01-01T00:00:00Z' },
      ];
      store.save();

      const res = await mockAchievementsRoute.request('/me', {
        headers: userHeaders(token),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Array<{ achievementId: string }>;
      expect(body).toHaveLength(1);
      expect(body[0]!.achievementId).toBe('obsession');
    });
  });

  // ─── P3: exchange-toggle wired to policy_kv ───
  describe('POST /api/admin/quota/exchange-toggle', () => {
    it('writes EXCHANGE_ENABLED to policyService and returns effective:true', async () => {
      const res = await adminQuotaRoute.request('/exchange-toggle', {
        method: 'POST',
        headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'usr_test01', reason: 'test', enabled: true }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; effective: boolean; enabled: boolean };
      expect(body.ok).toBe(true);
      expect(body.effective).toBe(true);
      expect(body.enabled).toBe(true);
    });
  });
});
