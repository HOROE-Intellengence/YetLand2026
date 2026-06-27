import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { preludeCardsService } from './prelude-cards';
import { resolveIfUnlockFromText, isSessionIfActive } from './if-unlock';

const IF_MARK = 'IF-CARD';
const BOUND_MARK = 'BOUND-CARD';
const ts = () => new Date().toISOString();

function seedUser(id: string) {
  store.state().users[id] = {
    id, phone: `138${id}`, token: `tok_${id}`, ageVerified: true,
    narrativeBoundary: 2, ifUnlocked: false, createdAt: ts(),
    candle: 100, registerGrant: 100, conversationRounds: 0,
  } as any;
}

function seedSession(id: string, userId: string, characterId: string) {
  store.state().sessions[id] = {
    id, userId, characterId, mode: 'main', ifActive: false, round: 0, createdAt: ts(), updatedAt: ts(),
  } as any;
}

function seedChar(id: string, preludeCardId: string | null) {
  store.state().characters[id] = {
    id, slug: id, name: id, rarity: 'free', priceCandle: 0, styleTags: [], promptCardKey: 't',
    preludeCardId, boundaryDefault: 2, isActive: true,
    openingFirstVisit: '', openingReturnVisit: '', forbiddenPhrases: [], description: '', updatedAt: ts(),
  } as any;
}

// 忠实复刻 chat.ts 每轮的解析顺序：resolve → 派生 session 级信号 → 选前置卡
// 共用生产侧的 isSessionIfActive，确保与 chat.ts 不漂移。
function turn(userId: string, sessionId: string, characterId: string, text: string) {
  const ifUnlock = resolveIfUnlockFromText(userId, sessionId, text);
  const session = store.state().sessions[sessionId];
  const sessionIfActive = isSessionIfActive(session);
  const card = preludeCardsService.resolveForChat(characterId, sessionIfActive);
  return { ifUnlock, sessionIfActive, content: card?.content ?? null, sessionMode: session?.mode };
}

describe('多账户 × 多会话 × 多角色 复杂场景', () => {
  beforeEach(() => {
    store.__resetForTests();
    store.state().preludeCards['if-default'] = {
      id: 'if-default', name: 'IF', content: IF_MARK, scope: 'if', characterId: null, priority: 100, isActive: true, updatedAt: ts(),
    } as any;
    store.state().preludeCards['bound-1'] = {
      id: 'bound-1', name: 'Bound', content: BOUND_MARK, scope: 'character', characterId: 'char-bound', priority: 50, isActive: true, updatedAt: ts(),
    } as any;
    seedChar('char-bound', 'bound-1'); // 有专属绑定卡
    seedChar('char-free', null);       // 无绑定卡
    seedUser('alice');
    seedUser('bob');
  });

  it('1) alice 在 A1(char-bound)说暗号 → IF 卡压过绑定卡', () => {
    seedSession('A1', 'alice', 'char-bound');
    const r = turn('alice', 'A1', 'char-bound', '夜阑 YELAN-MOON');
    expect(r.ifUnlock.matched).toBe(true);
    expect(r.sessionMode).toBe('if');
    expect(r.content).toBe(IF_MARK);
  });

  it('2) alice 解锁后在 A2(char-free, 无暗号) → 不泄露 IF（全局解锁不外溢）', () => {
    seedSession('A1', 'alice', 'char-bound');
    seedSession('A2', 'alice', 'char-free');
    turn('alice', 'A1', 'char-bound', 'YELAN-MOON'); // 先解锁
    expect(store.state().users['alice']?.ifUnlocked).toBe(true); // user 级永久解锁

    const r = turn('alice', 'A2', 'char-free', '今天天气不错');
    expect(r.ifUnlock.ifActive).toBe(true); // 宽口径标志为真（温度软信号）
    expect(r.sessionIfActive).toBe(false);  // 但 session 级为假
    expect(r.sessionMode).toBe('main');
    expect(r.content).toBeNull();           // char-free 无卡，且不注入 IF
  });

  it('3) 关键：alice 解锁后另开 A3(char-bound, 无暗号) → 仍是绑定卡，不是 IF（跨角色不污染）', () => {
    seedSession('A1', 'alice', 'char-bound');
    seedSession('A3', 'alice', 'char-bound');
    turn('alice', 'A1', 'char-bound', 'YELAN-MOON');

    const r = turn('alice', 'A3', 'char-bound', '在吗');
    expect(r.sessionMode).toBe('main');
    expect(r.content).toBe(BOUND_MARK); // 绑定卡保留，没被 IF 顶掉
  });

  it('4) 跨用户隔离：alice 解锁不影响 bob 的会话', () => {
    seedSession('A1', 'alice', 'char-bound');
    seedSession('B1', 'bob', 'char-bound');
    turn('alice', 'A1', 'char-bound', 'YELAN-MOON');

    const r = turn('bob', 'B1', 'char-bound', '你好');
    expect(r.ifUnlock.ifActive).toBe(false); // bob 从未解锁
    expect(r.sessionMode).toBe('main');
    expect(r.content).toBe(BOUND_MARK);
  });

  it('5) 按 session 独立激活：alice 在 A2 再说一次暗号 → A2 转 IF，但 A3 不受影响', () => {
    seedSession('A2', 'alice', 'char-free');
    seedSession('A3', 'alice', 'char-bound');

    const r2 = turn('alice', 'A2', 'char-free', 'yelan-moon');
    expect(r2.sessionMode).toBe('if');
    expect(r2.content).toBe(IF_MARK);

    const r3 = turn('alice', 'A3', 'char-bound', '随便说说'); // A3 没说暗号
    expect(r3.sessionMode).toBe('main');
    expect(r3.content).toBe(BOUND_MARK); // A3 仍绑定卡，会话彼此独立
  });

  it('6) 已激活 session 的后续轮次保持 IF（不需要每轮重说暗号）', () => {
    seedSession('A1', 'alice', 'char-bound');
    turn('alice', 'A1', 'char-bound', 'YELAN-MOON'); // 第 1 轮解锁

    const r = turn('alice', 'A1', 'char-bound', '后面普通聊天'); // 第 2 轮无暗号
    expect(r.sessionMode).toBe('if');
    expect(r.content).toBe(IF_MARK); // 本 session 内 IF 持续生效
  });
});
