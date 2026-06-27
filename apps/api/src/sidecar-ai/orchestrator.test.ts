import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import {
  SIDECAR_KEYS,
  DEFAULT_SIDECAR_ORDER,
  isValidSidecarOrder,
  getFullSidecarOrder,
  getEffectiveSidecarOrder,
  orderSidecars,
  isSidecarEnabled,
  getSidecarEnabledMap,
  setSidecarEnabled,
  setSidecarOrder,
} from './orchestrator';

describe('sidecar orchestrator', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  // ── 真理源 ──────────────────────────────────────────────────
  it('SIDECAR_KEYS has exactly 5 unique keys', () => {
    expect(SIDECAR_KEYS).toHaveLength(5);
    expect(new Set(SIDECAR_KEYS).size).toBe(5);
  });

  it('DEFAULT_SIDECAR_ORDER contains all 5 keys', () => {
    expect(DEFAULT_SIDECAR_ORDER).toHaveLength(5);
    for (const k of SIDECAR_KEYS) {
      expect(DEFAULT_SIDECAR_ORDER).toContain(k);
    }
  });

  // ── 校验 ──────────────────────────────────────────────────
  it('isValidSidecarOrder rejects duplicates', () => {
    expect(isValidSidecarOrder(['atmosphereJudge', 'atmosphereJudge', 'atmosphereJudge', 'atmosphereJudge', 'atmosphereJudge'])).toBe(false);
  });

  it('isValidSidecarOrder rejects wrong length', () => {
    expect(isValidSidecarOrder(['atmosphereJudge', 'outputStructurer'])).toBe(false);
    expect(isValidSidecarOrder([...SIDECAR_KEYS, 'atmosphereJudge'] as any)).toBe(false);
  });

  it('isValidSidecarOrder rejects missing keys', () => {
    const missing = ['atmosphereJudge', 'outputStructurer', 'preferenceRecorder', 'quotaEnding', 'atmosphereJudge'] as any;
    expect(isValidSidecarOrder(missing)).toBe(false);
  });

  it('isValidSidecarOrder rejects non-array', () => {
    expect(isValidSidecarOrder(null)).toBe(false);
    expect(isValidSidecarOrder(undefined)).toBe(false);
    expect(isValidSidecarOrder('string')).toBe(false);
  });

  it('isValidSidecarOrder accepts valid order', () => {
    const valid = [...SIDECAR_KEYS];
    expect(isValidSidecarOrder(valid)).toBe(true);
  });

  it('isValidSidecarOrder accepts any permutation of 5 keys', () => {
    const perm = ['contextCompressor', 'quotaEnding', 'preferenceRecorder', 'atmosphereJudge', 'outputStructurer'];
    expect(isValidSidecarOrder(perm)).toBe(true);
  });

  // ── 默认状态 ──────────────────────────────────────────────
  it('getFullSidecarOrder returns default on fresh state', () => {
    expect(getFullSidecarOrder()).toEqual(DEFAULT_SIDECAR_ORDER);
  });

  it('getEffectiveSidecarOrder returns all 5 when all enabled', () => {
    expect(getEffectiveSidecarOrder()).toEqual(DEFAULT_SIDECAR_ORDER);
  });

  it('getSidecarEnabledMap returns all true initially', () => {
    const map = getSidecarEnabledMap();
    for (const k of SIDECAR_KEYS) expect(map[k]).toBe(true);
  });

  // ── 开关 ─────────────────────────────────────────────────
  it('isSidecarEnabled returns true for all keys by default', () => {
    for (const k of SIDECAR_KEYS) expect(isSidecarEnabled(k)).toBe(true);
  });

  it('setSidecarEnabled toggles individual key', () => {
    setSidecarEnabled('atmosphereJudge', false);
    expect(isSidecarEnabled('atmosphereJudge')).toBe(false);
    expect(isSidecarEnabled('outputStructurer')).toBe(true);
  });

  it('disabled key disappears from effectiveOrder', () => {
    setSidecarEnabled('contextCompressor', false);
    const effective = getEffectiveSidecarOrder();
    expect(effective).not.toContain('contextCompressor');
    expect(effective).toHaveLength(4);
  });

  it('disabling all makes effectiveOrder empty', () => {
    for (const k of SIDECAR_KEYS) setSidecarEnabled(k, false);
    expect(getEffectiveSidecarOrder()).toEqual([]);
  });

  // ── 排序 ─────────────────────────────────────────────────
  it('orderSidecars sorts subset by configured order', () => {
    setSidecarOrder(['contextCompressor', 'preferenceRecorder', 'atmosphereJudge', 'outputStructurer', 'quotaEnding']);
    const sorted = orderSidecars(['preferenceRecorder', 'contextCompressor']);
    expect(sorted).toEqual(['contextCompressor', 'preferenceRecorder']);
  });

  it('orderSidecars filters out disabled keys', () => {
    setSidecarEnabled('preferenceRecorder', false);
    const sorted = orderSidecars(['preferenceRecorder', 'contextCompressor']);
    expect(sorted).toEqual(['contextCompressor']);
  });

  it('orderSidecars ignores keys not in the configured order', () => {
    const sorted = orderSidecars(['preferenceRecorder', 'contextCompressor']);
    // default order: atmosphere → output → preference → quota → context
    expect(sorted).toEqual(['preferenceRecorder', 'contextCompressor']);
  });

  // ── 写入守卫 ─────────────────────────────────────────────
  it('setSidecarOrder throws on invalid input', () => {
    expect(() => setSidecarOrder(['atmosphereJudge', 'atmosphereJudge', 'atmosphereJudge', 'atmosphereJudge', 'atmosphereJudge'])).toThrow('invalid sidecar order');
  });

  it('setSidecarOrder accepts valid input', () => {
    const perm: typeof SIDECAR_KEYS = ['quotaEnding', 'contextCompressor', 'atmosphereJudge', 'outputStructurer', 'preferenceRecorder'];
    setSidecarOrder(perm);
    expect(getFullSidecarOrder()).toEqual(perm);
  });

  // ── 脏 order 自动修复 ──────────────────────────────────────
  it('getFullSidecarOrder falls back to default when state has dirty order', () => {
    // simulate dirty state by writing invalid array directly
    (store.state() as any).sidecarOrder = ['x', 'y', 'z'] as any;
    expect(getFullSidecarOrder()).toEqual(DEFAULT_SIDECAR_ORDER);
  });
});
