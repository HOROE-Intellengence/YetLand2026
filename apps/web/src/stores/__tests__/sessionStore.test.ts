import { describe, expect, it, beforeEach } from 'vitest';
import { useSessionStore } from '../sessionStore';
import type { Character } from '@yelan/shared';

const mockCharacter: Character = {
  id: 'jiang-bai',
  slug: 'jiang-bai',
  name: '江白',
  rarity: 'paid',
  priceCandle: 120,
  styleTags: ['cool'],
  promptCardKey: 'characters/jiang-bai.yaml',
  preludeCardId: null,
  boundaryDefault: 2,
  isActive: true,
  openingLines: { firstVisit: '你好', returnVisit: '又见面了' },
  description: '一个酷酷的角色',
  forbiddenPhrases: [],
  updatedAt: new Date().toISOString(),
};

describe('sessionStore', () => {
  beforeEach(() => {
    useSessionStore.getState().restart();
  });

  it('restart starts at intro scene', () => {
    expect(useSessionStore.getState().scene).toBe('intro');
  });

  it('enters intro from landing scene', () => {
    useSessionStore.setState({ scene: 'home' });
    useSessionStore.getState().goIntro();
    expect(useSessionStore.getState().scene).toBe('intro');
  });

  it('flows through scene transitions', () => {
    const s = useSessionStore.getState();

    s.goOpening();
    expect(useSessionStore.getState().scene).toBe('opening');

    s.setGreeting('晚上好');
    const afterGreet = useSessionStore.getState();
    expect(afterGreet.scene).toBe('name');
    expect(afterGreet.greeting).toBe('晚上好');

    s.setUserName('阿明');
    const afterName = useSessionStore.getState();
    expect(afterName.scene).toBe('select');
    expect(afterName.userName).toBe('阿明');

    s.pickCharacter(mockCharacter);
    const afterPick = useSessionStore.getState();
    expect(afterPick.scene).toBe('chat');
    expect(afterPick.character?.id).toBe('jiang-bai');
  });

  it('cutoff transitions to end scene', () => {
    useSessionStore.getState().pickCharacter(mockCharacter);
    useSessionStore.getState().cutoff();
    expect(useSessionStore.getState().scene).toBe('end');
  });

  it('restart resets to intro', () => {
    useSessionStore.getState().pickCharacter(mockCharacter);
    useSessionStore.getState().setStage('climax');
    useSessionStore.getState().restart();
    const s = useSessionStore.getState();
    expect(s.scene).toBe('intro');
    expect(s.character).toBeNull();
    expect(s.greeting).toBe('');
    expect(s.userName).toBe('');
  });

  it('pushAchievement and clearAchievement', () => {
    const notice = { slug: 'first-chat', name: '初次对话', rewardCandle: 10 };
    useSessionStore.getState().pushAchievement(notice);
    expect(useSessionStore.getState().achievement).toEqual(notice);
    useSessionStore.getState().clearAchievement();
    expect(useSessionStore.getState().achievement).toBeNull();
  });

  it('setStage and setTemperature update state', () => {
    useSessionStore.getState().setStage('rise');
    useSessionStore.getState().setTemperature(4);
    expect(useSessionStore.getState().stage).toBe('rise');
    expect(useSessionStore.getState().temperature).toBe(4);
  });
});
