import { describe, expect, it } from 'vitest';
import { normalizeProfileSections } from './characters';

describe('sanitized character sections', () => {
  it('preserves untitled section content and ordering without inventing original titles', () => {
    expect(normalizeProfileSections([
      { value: '正文 B', order: 2 },
      { key: '原始标题', value: '正文 A', order: 1 },
      null,
      { value: '' },
    ])).toEqual([
      { key: '原始标题', value: '正文 A', order: 0 },
      { key: '未命名设定 1', value: '正文 B', order: 1 },
    ]);
  });
});
