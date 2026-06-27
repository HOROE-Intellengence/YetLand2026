import { describe, expect, it } from 'vitest';
import { effectiveBoundary } from './boundary';

describe('effectiveBoundary', () => {
  it('uses the stricter of user boundary and global maximum', () => {
    expect(effectiveBoundary(5, 2)).toBe(2);
    expect(effectiveBoundary(2, 5)).toBe(2);
    expect(effectiveBoundary(3, 3)).toBe(3);
  });
});
