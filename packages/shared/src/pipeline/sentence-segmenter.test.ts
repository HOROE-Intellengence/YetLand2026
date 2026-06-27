import { describe, expect, it } from 'vitest';
import { isSentenceEnd, maybeGlow } from './sentence-segmenter';

describe('sentence segmenter', () => {
  it('detects Chinese and western sentence endings', () => {
    expect(isSentenceEnd('你来了。')).toBe(true);
    expect(isSentenceEnd('真的吗？')).toBe(true);
    expect(isSentenceEnd('wait!')).toBe(true);
    expect(isSentenceEnd('还没有')).toBe(false);
  });

  it('allows closing quotes and brackets after punctuation', () => {
    expect(isSentenceEnd('他说：“别走。”')).toBe(true);
    expect(isSentenceEnd('真的吗？）')).toBe(true);
  });

  it('marks emotionally important sentences as glow candidates', () => {
    expect(maybeGlow('其实我一直记得你。')).toBe(true);
    expect(maybeGlow('嗯。')).toBe(false);
  });
});
