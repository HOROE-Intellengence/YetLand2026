// memory-gate 集成测试 —— flag 两态 + 节流 + 关键词 override
// 覆盖 T2-C 收尾标志 #5（flag=off / flag=on 首轮 / flag=on 节流 / flag=on 关键词）
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { clearPolicyCache } from '../services/policy';
import { clearFlagCache } from '../config/feature-flags';
import { mockChatRoute } from '../routes/chat';

function makeUser(suffix = '01') {
  const s = store.state();
  const id = `usr_mg_${suffix}`;
  const token = `tok_mg_${suffix}`;
  s.users[id] = {
    id,
    phone: `1380000${suffix}`,
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
  s.phoneIndex[`1380000${suffix}`] = id;
  store.save();
  return { id, token };
}

function setupCharacter() {
  store.state().characters['mg-char'] = {
    id: 'mg-char',
    slug: 'mg',
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

async function sendRound(opts: {
  token: string;
  sessionId: string;
  round: number;
  prevStage: 'daily' | 'rise' | 'climax' | 'after' | 'end';
  text: string;
}) {
  const res = await mockChatRoute.request('/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      characterId: 'mg-char',
      sessionId: opts.sessionId,
      round: opts.round,
      prevStage: opts.prevStage,
      userBoundary: 2,
      text: opts.text,
      history: [],
    }),
  });
  expect(res.status).toBe(200);
  await res.text();
}

describe('memory-gate integration (FEATURE_MEMORY_THROTTLE)', () => {
  beforeEach(() => {
    store.__resetForTests();
    clearPolicyCache();
    delete process.env.FEATURE_MEMORY_THROTTLE;
    clearFlagCache();
  });

  afterEach(() => {
    delete process.env.FEATURE_MEMORY_THROTTLE;
    clearFlagCache();
  });

  it('flag=off: lastMemoryRound stays undefined regardless of decision', async () => {
    const { token } = makeUser('01');
    setupCharacter();

    await sendRound({ token, sessionId: 'sess_off_1', round: 0, prevStage: 'daily', text: 'hello' });

    const sess = store.state().sessions.sess_off_1;
    expect(sess).toBeDefined();
    expect(sess!.lastMemoryRound).toBeUndefined();
  });

  it('flag=on first turn: writes lastMemoryRound=0 (first-turn reason)', async () => {
    process.env.FEATURE_MEMORY_THROTTLE = 'on';
    clearFlagCache();
    const { token } = makeUser('02');
    setupCharacter();

    await sendRound({ token, sessionId: 'sess_on_first', round: 0, prevStage: 'daily', text: 'hello' });

    const sess = store.state().sessions.sess_on_first;
    expect(sess!.lastMemoryRound).toBe(0);
  });

  it('flag=on second turn same stage no keyword: throttled, lastMemoryRound unchanged', { timeout: 15000 }, async () => {
    process.env.FEATURE_MEMORY_THROTTLE = 'on';
    clearFlagCache();
    const { token } = makeUser('03');
    setupCharacter();

    await sendRound({ token, sessionId: 'sess_on_thr', round: 0, prevStage: 'daily', text: 'hello' });
    const afterFirst = store.state().sessions.sess_on_thr!.lastMemoryRound;
    expect(afterFirst).toBe(0);

    // round=1, same stage, no keyword → judgeStage 仍返回 daily → throttled
    await sendRound({ token, sessionId: 'sess_on_thr', round: 1, prevStage: 'daily', text: '嗯' });
    const afterSecond = store.state().sessions.sess_on_thr!.lastMemoryRound;
    expect(afterSecond).toBe(0); // 未刷新
  });

  it('flag=on second turn with keyword "关系": override fires, lastMemoryRound=1', { timeout: 15000 }, async () => {
    process.env.FEATURE_MEMORY_THROTTLE = 'on';
    clearFlagCache();
    const { token } = makeUser('04');
    setupCharacter();

    await sendRound({ token, sessionId: 'sess_on_kw', round: 0, prevStage: 'daily', text: 'hello' });
    expect(store.state().sessions.sess_on_kw!.lastMemoryRound).toBe(0);

    await sendRound({
      token,
      sessionId: 'sess_on_kw',
      round: 1,
      prevStage: 'daily',
      text: '我们关系走到哪一步了',
    });
    expect(store.state().sessions.sess_on_kw!.lastMemoryRound).toBe(1);
  });
});
