import { describe, expect, it } from 'vitest';
import { parseConstellationDsl, serializeConstellationDsl } from './constellation-dsl';

describe('parseConstellationDsl', () => {
  it('parses a clean constellation with comments and blank lines', () => {
    const text = `# points: id x y
A 50 -25
B 25 -10
C 75 -10

# edges
A-B
A-C`;
    const r = parseConstellationDsl(text);
    expect(r.ok).toBe(true);
    expect(r.data?.points).toHaveLength(3);
    expect(r.data?.edges).toHaveLength(2);
    expect(r.data?.points[0]).toEqual({ id: 'A', x: 50, y: -25 });
  });

  it('tolerates commas (ascii + fullwidth) and extra whitespace', () => {
    const r = parseConstellationDsl('A, 10 , 20\nB，30，40\nA  B');
    expect(r.ok).toBe(true);
    expect(r.data?.points).toHaveLength(2);
    expect(r.data?.edges).toEqual([{ from: 'A', to: 'B' }]);
  });

  it('accepts all three edge forms: A-B, A->B, A B', () => {
    const r = parseConstellationDsl('A 0 0\nB 10 10\nC 20 20\nA-B\nB->C\nA C');
    expect(r.ok).toBe(true);
    expect(r.data?.edges).toHaveLength(3);
  });

  it('strips inline comments after #', () => {
    const r = parseConstellationDsl('A 50 -25  # 顶点\nB 25 -10\nA-B # 连一条');
    expect(r.ok).toBe(true);
    expect(r.data?.points).toHaveLength(2);
    expect(r.data?.edges).toHaveLength(1);
  });

  it('dedupes undirected duplicate edges silently', () => {
    const r = parseConstellationDsl('A 0 0\nB 10 10\nA-B\nB-A');
    expect(r.ok).toBe(true);
    expect(r.data?.edges).toHaveLength(1);
  });

  it('rejects duplicate point ids with a line number', () => {
    const r = parseConstellationDsl('A 0 0\nA 10 10');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('第 2 行') && e.includes('重复'))).toBe(true);
  });

  it('rejects edges referencing unknown points', () => {
    const r = parseConstellationDsl('A 0 0\nA-Z');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('不存在') && e.includes('Z'))).toBe(true);
  });

  it('rejects x out of range', () => {
    const r = parseConstellationDsl('A 120 0');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('x=120') && e.includes('超出范围'))).toBe(true);
  });

  it('rejects y out of range (below -40)', () => {
    const r = parseConstellationDsl('A 0 -50');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('y=-50'))).toBe(true);
  });

  it('rejects self-loop edges', () => {
    const r = parseConstellationDsl('A 0 0\nA-A');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('两端相同'))).toBe(true);
  });

  it('rejects unrecognizable lines with a line number', () => {
    const r = parseConstellationDsl('A 0 0\nthis is bad\nB 10 10');
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes('第 2 行') && e.includes('无法识别'))).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const r = parseConstellationDsl('A 999 0\nB 0 0\nB 1 1');
    expect(r.ok).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('accepts an empty constellation', () => {
    const r = parseConstellationDsl('# nothing here\n\n');
    expect(r.ok).toBe(true);
    expect(r.data).toEqual({ points: [], edges: [] });
  });
});

describe('serializeConstellationDsl round-trip', () => {
  it('re-parses to the same structure', () => {
    const original = {
      points: [
        { id: 'A', x: 50, y: -25 },
        { id: 'B', x: 25, y: -10 },
        { id: 'C', x: 75, y: 15.5 },
      ],
      edges: [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'C' },
      ],
    };
    const text = serializeConstellationDsl(original);
    const r = parseConstellationDsl(text);
    expect(r.ok).toBe(true);
    expect(r.data).toEqual(original);
  });
});
