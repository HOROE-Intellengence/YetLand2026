import { describe, expect, it } from 'vitest';
import { ConstellationSchema } from '../characters';
import { AdminConstellationPutSchema } from '../admin';

const validBody = {
  points: [
    { id: 'A', x: 50, y: -20 },
    { id: 'B', x: 20, y: 40 },
    { id: 'C', x: 80, y: 40 },
  ],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C' },
  ],
};

describe('ConstellationSchema', () => {
  it('accepts a well-formed constellation', () => {
    expect(ConstellationSchema.safeParse(validBody).success).toBe(true);
  });

  it('rejects x out of [0,100]', () => {
    const r = ConstellationSchema.safeParse({ points: [{ id: 'A', x: 120, y: 0 }], edges: [] });
    expect(r.success).toBe(false);
  });

  it('rejects y below -40', () => {
    const r = ConstellationSchema.safeParse({ points: [{ id: 'A', x: 0, y: -50 }], edges: [] });
    expect(r.success).toBe(false);
  });

  it('rejects y above 100', () => {
    const r = ConstellationSchema.safeParse({ points: [{ id: 'A', x: 0, y: 140 }], edges: [] });
    expect(r.success).toBe(false);
  });

  it('rejects duplicate point ids', () => {
    const r = ConstellationSchema.safeParse({
      points: [
        { id: 'A', x: 10, y: 10 },
        { id: 'A', x: 20, y: 20 },
      ],
      edges: [],
    });
    expect(r.success).toBe(false);
  });

  it('rejects edges referencing an unknown point', () => {
    const r = ConstellationSchema.safeParse({
      points: [{ id: 'A', x: 10, y: 10 }],
      edges: [{ from: 'A', to: 'Z' }],
    });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.some((i) => i.message.includes('Z'))).toBe(true);
    }
  });

  it('accepts an empty constellation (no points, no edges)', () => {
    expect(ConstellationSchema.safeParse({ points: [], edges: [] }).success).toBe(true);
  });
});

describe('AdminConstellationPutSchema', () => {
  it('requires a non-empty reason', () => {
    expect(AdminConstellationPutSchema.safeParse(validBody).success).toBe(false);
    expect(AdminConstellationPutSchema.safeParse({ ...validBody, reason: '调整弧度' }).success).toBe(true);
  });

  it('enforces the same edge-integrity rule as the base schema', () => {
    const r = AdminConstellationPutSchema.safeParse({
      points: [{ id: 'A', x: 0, y: 0 }],
      edges: [{ from: 'A', to: 'B' }],
      reason: 'x',
    });
    expect(r.success).toBe(false);
  });
});
