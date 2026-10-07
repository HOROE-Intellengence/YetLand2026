import { describe, expect, it } from 'vitest';
import { memoryParts } from './yelan-memory-parts';

describe('phone memory upload parts', () => {
  it('preserves a long entry including its tail and split-boundary emojis', () => {
    const content = '甲'.repeat(5987) + '🌙'.repeat(3500) + '不能丢失的结尾';
    const parts = memoryParts({ timestamp: '123', content });
    expect(parts.length).toBeGreaterThan(2);
    expect(parts.every(part => part.length <= 6000)).toBe(true);
    expect(parts.map(part => part.slice('[123] '.length)).join('')).toBe(content);
    expect(parts.every(part => !/[\uD800-\uDBFF]$/.test(part))).toBe(true);
  });
  it('does not upload an empty entry and has deterministic parts for retries', () => {
    expect(memoryParts({ timestamp: '1', content: '' })).toEqual([]);
    const entry = { timestamp: '1', content: '已确认的事件'.repeat(3000) };
    expect(memoryParts(entry)).toEqual(memoryParts(entry));
  });
});
