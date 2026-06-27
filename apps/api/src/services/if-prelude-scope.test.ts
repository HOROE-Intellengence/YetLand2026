import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { preludeCardsService } from './prelude-cards';
import { resolveIfUnlockFromText, isSessionIfActive } from './if-unlock';

const IF_MARK = 'IF-CARD-CONTENT';
const BOUND_MARK = 'BOUND-CARD-CONTENT';
const ts = () => new Date().toISOString();

function seedCards() {
  store.state().preludeCards['if-default'] = {
    id: 'if-default', name: 'IF', content: IF_MARK,
    scope: 'if', characterId: null, priority: 100, isActive: true, updatedAt: ts(),
  } as any;
  store.state().preludeCards['bound-1'] = {
    id: 'bound-1', name: 'Bound', content: BOUND_MARK,
    scope: 'character', characterId: 'char-bound', priority: 50, isActive: true, updatedAt: ts(),
  } as any;
}

function seedChar(id: string, preludeCardId: string | null) {
  store.state().characters[id] = {
    id, slug: id, name: 'C', rarity: 'free', priceCandle: 0, styleTags: [], promptCardKey: 't',
    preludeCardId, boundaryDefault: 2, isActive: true,
    openingFirstVisit: '', openingReturnVisit: '', forbiddenPhrases: [], description: '', updatedAt: ts(),
  } as any;
}

function seedSession(id: string, userId: string, characterId: string) {
  store.state().sessions[id] = {
    id, userId, characterId, mode: 'main', ifActive: false, round: 0, createdAt: ts(), updatedAt: ts(),
  } as any;
}

describe('Fix A: IF 前置卡优先级', () => {
  beforeEach(() => {
    store.__resetForTests();
    seedCards();
  });

  it('ifActive=true：IF 卡压过角色绑定卡', () => {
    seedChar('char-bound', 'bound-1');
    expect(preludeCardsService.resolveForChat('char-bound', true)?.content).toBe(IF_MARK);
  });

  it('ifActive=false：保留绑定卡，不泄露 IF 内容', () => {
    seedChar('char-bound', 'bound-1');
    expect(preludeCardsService.resolveForChat('char-bound', false)?.content).toBe(BOUND_MARK);
  });

  it('无绑定卡：ifActive 切换 IF 卡有/无', () => {
    seedChar('char-free', null);
    expect(preludeCardsService.resolveForChat('char-free', true)?.content).toBe(IF_MARK);
    expect(preludeCardsService.resolveForChat('char-free', false)).toBeNull();
  });
});

describe('isSessionIfActive 真值表（独立钉契约，防共享后失去验证）', () => {
  it.each([
    ['mode=if', { mode: 'if', ifActive: false }, true],
    ['ifActive=true', { mode: 'main', ifActive: true }, true],
    ['both true', { mode: 'if', ifActive: true }, true],
    ['both false', { mode: 'main', ifActive: false }, false],
    ['mode=main, ifActive undefined', { mode: 'main' }, false],
  ] as const)('%s → %s', (_label, sess, expected) => {
    expect(isSessionIfActive(sess as any)).toBe(expected);
  });

  it('undefined / null session → false', () => {
    expect(isSessionIfActive(undefined)).toBe(false);
    expect(isSessionIfActive(null)).toBe(false);
  });
});

describe('选项2：user 级永久解锁不污染其它 session', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('全局已解锁的用户在新 session(无暗号)：session 仍为 main，sessionIfActive=false', () => {
    store.state().users['u1'] = { id: 'u1', narrativeBoundary: 4, ifUnlocked: true } as any;
    seedSession('fresh', 'u1', 'char-x');
    const r = resolveIfUnlockFromText('u1', 'fresh', '随便聊聊');
    expect(r.ifActive).toBe(true); // 宽口径标志仍 true（喂温度软信号用）
    const sess = store.state().sessions['fresh'];
    expect(sess?.mode).toBe('main'); // 关键：没被翻成 if
    expect(Boolean(sess?.ifActive || sess?.mode === 'if')).toBe(false); // session 级信号为假
  });

  it('在某 session 命中暗号：只翻该 session 为 if', () => {
    store.state().users['u2'] = { id: 'u2', narrativeBoundary: 2, ifUnlocked: false } as any;
    seedSession('s2', 'u2', 'char-x');
    const r = resolveIfUnlockFromText('u2', 's2', '夜阑，YELAN-MOON');
    expect(r.matched).toBe(true);
    expect(store.state().sessions['s2']?.mode).toBe('if');
  });
});
