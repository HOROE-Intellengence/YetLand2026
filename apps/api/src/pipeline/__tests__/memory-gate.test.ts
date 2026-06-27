import { describe, expect, it } from 'vitest';
import { shouldInjectMemory } from '../memory-gate';

describe('shouldInjectMemory', () => {
  it('case 1: first turn — lastMemoryRound is null', () => {
    const result = shouldInjectMemory({
      round: 1,
      lastMemoryRound: null,
      prevStage: 'daily',
      curStage: 'daily',
      userText: '你好',
    });
    expect(result.inject).toBe(true);
    expect(result.reason).toBe('first-turn');
  });

  it('case 2: throttled — same stage, no keyword, within throttle window', () => {
    const result = shouldInjectMemory({
      round: 2,
      lastMemoryRound: 1,
      prevStage: 'daily',
      curStage: 'daily',
      userText: '今天天气不错',
    });
    expect(result.inject).toBe(false);
    expect(result.reason).toBe('throttled');
  });

  it('case 3: throttle-elapsed — 4+ rounds since last injection', () => {
    const result = shouldInjectMemory({
      round: 5,
      lastMemoryRound: 1,
      prevStage: 'daily',
      curStage: 'daily',
      userText: '继续聊聊',
    });
    expect(result.inject).toBe(true);
    expect(result.reason).toBe('throttle-elapsed');
  });

  it('case 4: stage-change — prevStage differs from curStage', () => {
    const result = shouldInjectMemory({
      round: 3,
      lastMemoryRound: 1,
      prevStage: 'daily',
      curStage: 'rise',
      userText: '嗯...',
    });
    expect(result.inject).toBe(true);
    expect(result.reason).toBe('stage-change');
  });

  it('case 5: keyword hit — userText contains trigger keyword', () => {
    const result = shouldInjectMemory({
      round: 22,
      lastMemoryRound: 20,
      prevStage: 'climax',
      curStage: 'climax',
      userText: '我们关系走到哪一步了',
    });
    expect(result.inject).toBe(true);
    expect(result.reason).toBe('keyword');
  });
});
