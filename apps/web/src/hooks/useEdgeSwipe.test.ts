import { describe, expect, it } from 'vitest';
import { isInEdgeZone, isSwipeTriggered } from './useEdgeSwipe';

const VW = 400;

describe('isInEdgeZone', () => {
  it('右缘：靠近右边界才算', () => {
    expect(isInEdgeZone(VW - 5, 'right', VW, 28)).toBe(true); // 395 >= 372
    expect(isInEdgeZone(VW - 28, 'right', VW, 28)).toBe(true); // 372 == 边界
    expect(isInEdgeZone(VW - 40, 'right', VW, 28)).toBe(false); // 360 < 372
  });

  it('左缘：靠近左边界才算', () => {
    expect(isInEdgeZone(10, 'left', VW, 28)).toBe(true);
    expect(isInEdgeZone(28, 'left', VW, 28)).toBe(true);
    expect(isInEdgeZone(40, 'left', VW, 28)).toBe(false);
  });
});

describe('isSwipeTriggered', () => {
  it('右缘需向左滑超阈值', () => {
    expect(isSwipeTriggered(-60, 0, 'right', 50)).toBe(true);
    expect(isSwipeTriggered(-40, 0, 'right', 50)).toBe(false); // 未过阈值
    expect(isSwipeTriggered(60, 0, 'right', 50)).toBe(false); // 方向反了（向右）
  });

  it('左缘需向右滑超阈值', () => {
    expect(isSwipeTriggered(60, 0, 'left', 50)).toBe(true);
    expect(isSwipeTriggered(-60, 0, 'left', 50)).toBe(false);
  });

  it('纵向为主视为滚动，不触发', () => {
    expect(isSwipeTriggered(-60, 80, 'right', 50)).toBe(false); // |dy| > |dx|
    expect(isSwipeTriggered(-60, 59, 'right', 50)).toBe(true); // |dx| > |dy|
  });
});
