import { describe, expect, it } from 'vitest';
import { judgeStage } from './stage-engine';

describe('judgeStage', () => {
  it('starts in daily for early neutral turns', () => {
    expect(judgeStage({ round: 1, text: '今天有点累', hourLocal: 20, prevStage: 'daily' })).toBe('daily');
  });

  it('moves to climax on high-intensity keywords', () => {
    expect(judgeStage({ round: 2, text: '别走，抱紧我', hourLocal: 20, prevStage: 'daily' })).toBe('climax');
  });

  it('moves from climax to after on quiet aftermath keywords', () => {
    expect(judgeStage({ round: 8, text: '后来我们只是安静地靠着', hourLocal: 20, prevStage: 'climax' })).toBe('after');
  });

  it('does not move backwards from terminal stages', () => {
    expect(judgeStage({ round: 20, text: '告诉我', hourLocal: 20, prevStage: 'after' })).toBe('after');
    expect(judgeStage({ round: 20, text: '告诉我', hourLocal: 20, prevStage: 'end' })).toBe('end');
  });

  it('nudges late-night early conversation into rise', () => {
    expect(judgeStage({ round: 3, text: '还没睡', hourLocal: 2, prevStage: 'daily' })).toBe('rise');
  });
});
