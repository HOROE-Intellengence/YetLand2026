import { describe, expect, it } from 'vitest';
import { circularOffset, slotForOffset } from './CharacterSelect.carousel';

describe('circularOffset', () => {
  it('returns 0 when n <= 0', () => {
    expect(circularOffset(0, 0, 0)).toBe(0);
    expect(circularOffset(1, 0, -5)).toBe(0);
  });

  it('calculates offsets for n=5 symmetrically', () => {
    // Active is 2
    expect(circularOffset(0, 2, 5)).toBe(-2);
    expect(circularOffset(1, 2, 5)).toBe(-1);
    expect(circularOffset(2, 2, 5)).toBe(0);
    expect(circularOffset(3, 2, 5)).toBe(1);
    expect(circularOffset(4, 2, 5)).toBe(2);
  });

  it('calculates offsets for n=3 symmetrically', () => {
    // Active is 1
    expect(circularOffset(0, 1, 3)).toBe(-1);
    expect(circularOffset(1, 1, 3)).toBe(0);
    expect(circularOffset(2, 1, 3)).toBe(1);
  });

  it('calculates offsets for n=4 with slight asymmetry for offset 2', () => {
    // Active is 1
    expect(circularOffset(0, 1, 4)).toBe(-1);
    expect(circularOffset(1, 1, 4)).toBe(0);
    expect(circularOffset(2, 1, 4)).toBe(1);
    expect(circularOffset(3, 1, 4)).toBe(2);
  });

  it('handles wrap-around correctly', () => {
    // n=5, active is 4 (the last element)
    expect(circularOffset(0, 4, 5)).toBe(1); // i=0 is near right of active=4
    expect(circularOffset(1, 4, 5)).toBe(2); // i=1 is far right of active=4
    expect(circularOffset(2, 4, 5)).toBe(-2); // i=2 is far left of active=4
    expect(circularOffset(3, 4, 5)).toBe(-1); // i=3 is near left of active=4
    expect(circularOffset(4, 4, 5)).toBe(0); // i=4 is active
  });
});

describe('slotForOffset', () => {
  it('returns active styles for offset 0', () => {
    const slot = slotForOffset(0);
    expect(slot.w).toBe('340px');
    expect(slot.h).toBe('520px');
    expect(slot.scale).toBe(1);
    expect(slot.opacity).toBe(1);
    expect(slot.blur).toBe('0px');
    expect(slot.textOpacity).toBe(1);
    expect(slot.zIndex).toBe(100);
  });

  it('returns near side styles for offsets -1 and 1', () => {
    const slotLeft = slotForOffset(-1);
    const slotRight = slotForOffset(1);

    expect(slotLeft.w).toBe('260px');
    expect(slotLeft.h).toBe('430px');
    expect(slotLeft.scale).toBe(0.9);
    expect(slotLeft.opacity).toBe(0.68);
    expect(slotLeft.blur).toBe('0.6px');
    expect(slotLeft.textOpacity).toBe(0.55);
    expect(slotLeft.zIndex).toBe(80);

    expect(slotRight.x).toBe('23vw');
    expect(slotLeft.x).toBe('-23vw');
  });

  it('returns far thin strip styles for offsets -2 and 2', () => {
    const slotLeft = slotForOffset(-2);
    const slotRight = slotForOffset(2);

    expect(slotLeft.w).toBe('42px');
    expect(slotLeft.h).toBe('340px');
    expect(slotLeft.scale).toBe(0.88);
    expect(slotLeft.opacity).toBe(0.36);
    expect(slotLeft.blur).toBe('1.5px');
    expect(slotLeft.textOpacity).toBe(0);
    expect(slotLeft.zIndex).toBe(70);

    expect(slotRight.x).toBe('44vw');
    expect(slotLeft.x).toBe('-44vw');
  });

  it('returns invisible styles for offset abs > 2', () => {
    const slotFar = slotForOffset(3);
    const slotFarLeft = slotForOffset(-3);

    expect(slotFar.opacity).toBe(0);
    expect(slotFar.zIndex).toBe(0);
    expect(slotFarLeft.opacity).toBe(0);
    expect(slotFarLeft.zIndex).toBe(0);
  });
});
