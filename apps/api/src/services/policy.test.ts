import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { clearPolicyCache, policyService } from './policy';

describe('policyService', () => {
  beforeEach(() => {
    store.__resetForTests();
    clearPolicyCache();
  });

  it('seeds default policies on first read', () => {
    expect(policyService.get('DAILY_FREE_ROUND_LIMIT', 0)).toBe(20);
    expect(policyService.get('REGISTER_CANDLE_GRANT', 0)).toBe(100);
    expect(policyService.listAll().length).toBeGreaterThan(0);
  });

  it('returns fallback for unknown policy keys', () => {
    expect(policyService.get('UNKNOWN_POLICY', 7)).toBe(7);
    expect(() => policyService.set('UNKNOWN_POLICY', 1, 'test')).toThrow(/Unknown policy key/);
  });

  it('persists updates in memory and serves them after cache reset', () => {
    policyService.set('DAILY_FREE_ROUND_LIMIT', 3, 'test');
    expect(policyService.get('DAILY_FREE_ROUND_LIMIT', 20)).toBe(3);

    clearPolicyCache();
    expect(policyService.get('DAILY_FREE_ROUND_LIMIT', 20)).toBe(3);
  });
});
