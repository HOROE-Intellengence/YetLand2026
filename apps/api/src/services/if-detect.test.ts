import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { resolveIfUnlockFromText } from './if-unlock';

const ts = () => new Date().toISOString();

function seedUserSession(boundary = 2) {
  store.state().users['u'] = { id: 'u', narrativeBoundary: boundary, ifUnlocked: false } as any;
  store.state().sessions['s'] = {
    id: 's', userId: 'u', characterId: 'c', mode: 'main', ifActive: false,
    round: 0, createdAt: ts(), updatedAt: ts(),
  } as any;
}

function matched(text: string): boolean {
  // reset session each call so a prior match doesn't make ifActive sticky
  store.state().sessions['s'] = {
    id: 's', userId: 'u', characterId: 'c', mode: 'main', ifActive: false,
    round: 0, createdAt: ts(), updatedAt: ts(),
  } as any;
  store.state().users['u']!.ifUnlocked = false as any;
  return resolveIfUnlockFromText('u', 's', text).matched;
}

describe('Step 3: 暗号检测硬化', () => {
  beforeEach(() => {
    store.__resetForTests();
    seedUserSession();
    // seeded codes: YELAN-DAWN, YELAN-MOON
  });

  describe('修漏命中', () => {
    it.each([
      ['精确', 'YELAN-MOON'],
      ['小写', 'yelan-moon'],
      ['嵌入中文句', '夜阑，我想对你说 YELAN-MOON'],
      ['空格代连字符', 'YELAN MOON'],
      ['全角连字符', 'YELAN－MOON'],
      ['中文破折号', '夜阑——YELAN-MOON。'],
      ['下划线', 'YELAN_MOON'],
    ])('命中 [%s] %s', (_label, text) => {
      expect(matched(text)).toBe(true);
    });
  });

  describe('防误命中', () => {
    it.each([
      ['真被拆开', 'YELAN 的 MOON'],
      ['无暗号闲聊', '今晚月色很美'],
    ])('不命中 [%s] %s', (_label, text) => {
      expect(matched(text)).toBe(false);
    });

    it('短码不被更长的词误中（MOON ⊄ MOONLIGHT）', () => {
      store.state().ifCodes.push({ code: 'MOON', boundary: 3, source: 'seed', active: true } as any);
      expect(matched('今晚的 MOONLIGHT 真亮')).toBe(false);
      expect(matched('看 MOON 了')).toBe(true); // 独立 token 仍命中
    });
  });
});
