// chat 路由单测 — SSE 流、校验、额度截断
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { clearPolicyCache } from '../services/policy';
import { mockChatRoute, STRUCTURER_BUDGET_MS } from '../routes/chat';
import { OUTPUT_STRUCTURER_TIMEOUT_MS } from '../sidecar-ai/output-structurer';

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

function setupCharacter() {
  store.state().characters['test-char'] = {
    id: 'test-char',
    slug: 'test',
    name: '测试',
    rarity: 'free',
    priceCandle: 0,
    styleTags: [],
    boundaryDefault: 2,
    isActive: true,
    openingFirstVisit: '你好',
    openingReturnVisit: '你好',
    forbiddenPhrases: [],
    description: '测试',
    updatedAt: new Date().toISOString(),
  };
  store.save();
}

describe('POST /api/chat', () => {
  beforeEach(() => {
    store.__resetForTests();
    clearPolicyCache();
  });

  it('keeps the structurer route budget above the sidecar timeout', () => {
    expect(STRUCTURER_BUDGET_MS).toBeGreaterThanOrEqual(OUTPUT_STRUCTURER_TIMEOUT_MS);
  });

  it('returns 400 VALIDATION_ERROR on empty body', async () => {
    const res = await mockChatRoute.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 when missing characterId', async () => {
    const { token } = makeUser();
    const res = await mockChatRoute.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        sessionId: 'sess_1',
        round: 0,
        prevStage: 'daily',
        userBoundary: 2,
        text: '你好',
        history: [],
      }),
    });
    expect(res.status).toBe(400);
  });

  it('returns CHARACTER_NOT_FOUND for non-existent characterId', async () => {
    const { token } = makeUser();
    const res = await mockChatRoute.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        characterId: 'nonexistent',
        sessionId: 'sess_1',
        round: 0,
        prevStage: 'daily',
        userBoundary: 2,
        text: '你好',
        history: [],
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('CHARACTER_NOT_FOUND');
  });

  it('returns SSE stream with meta, chunk, and done events', async () => {
    const { token } = makeUser();
    setupCharacter();

    const res = await mockChatRoute.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
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

  it('creates a session row for direct frontend chat requests', async () => {
    const { id: userId, token } = makeUser();
    setupCharacter();

    const res = await mockChatRoute.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        characterId: 'test-char',
        sessionId: 'local_test_frontend',
        round: 0,
        prevStage: 'daily',
        userBoundary: 2,
        text: 'hello',
        history: [],
      }),
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(store.state().sessions.local_test_frontend).toMatchObject({
      id: 'local_test_frontend',
      userId,
      characterId: 'test-char',
      mode: 'main',
    });
    expect(store.state().messages.local_test_frontend?.[0]).toMatchObject({
      sessionId: 'local_test_frontend',
      role: 'user',
      content: 'hello',
    });
  });

  it('includes atmosphere event between meta and chunks', async () => {
    const { token } = makeUser();
    setupCharacter();

    const res = await mockChatRoute.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        characterId: 'test-char',
        sessionId: 'sess_atmo',
        round: 0,
        prevStage: 'daily',
        userBoundary: 2,
        text: '你好',
        history: [],
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"kind":"atmosphere"');
  });

  it('returns cutoff SSE when quota is exhausted', async () => {
    const { token } = makeUser();
    setupCharacter();
    const date = new Date().toISOString().slice(0, 10);
    store.state().quota['usr_test01'] = {
      [date]: { date, freeUsed: 99, bonusUsed: 0, bonusLimit: 0 },
    };
    store.state().freeLimitOverride = 5;
    store.save();

    const res = await mockChatRoute.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        characterId: 'test-char',
        sessionId: 'sess_cutoff',
        round: 0,
        prevStage: 'daily',
        userBoundary: 2,
        text: '你好',
        history: [],
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('"kind":"cutoff"');
  });

  it('includes tokenGuard in meta when SESSION_TOKEN_LIMIT is set', async () => {
    process.env.SESSION_TOKEN_LIMIT = '100';
    const { token } = makeUser();
    setupCharacter();

    const res = await mockChatRoute.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        characterId: 'test-char',
        sessionId: 'sess_guard',
        round: 0,
        prevStage: 'daily',
        userBoundary: 2,
        text: '你好',
        history: [],
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const metaLine = text
      .split('\n')
      .find((l) => l.startsWith('data:') && l.includes('"kind":"meta"'));
    expect(metaLine).toBeTruthy();
    const meta = JSON.parse(metaLine!.slice(5).trim());
    expect(meta.tokenGuard).toBeDefined();

    delete process.env.SESSION_TOKEN_LIMIT;
  });

  it('all events share the same requestId', async () => {
    const { token } = makeUser();
    setupCharacter();

    const res = await mockChatRoute.request('/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({
        characterId: 'test-char',
        sessionId: 'sess_reqid',
        round: 0,
        prevStage: 'daily',
        userBoundary: 2,
        text: '你好',
        history: [],
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    const ids = new Set<string>();
    for (const line of text.split('\n')) {
      if (!line.startsWith('data:')) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed.requestId) ids.add(parsed.requestId);
      } catch { /* skip */ }
    }
    expect(ids.size).toBe(1);
    const [id] = ids;
    expect(id).toBeTruthy();
  });
});
