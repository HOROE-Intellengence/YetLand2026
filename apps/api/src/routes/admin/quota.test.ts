import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../store/persistence';
import { clearPolicyCache, policyService } from '../../services/policy';
import { consumeOneRound, getQuotaForDate } from '../../services/users';
import { adminQuotaRoute } from './quota';

describe('admin quota route', () => {
  beforeEach(() => {
    store.__resetForTests();
    clearPolicyCache();
  });

  it('reports the effective policy free limit when no override is set', async () => {
    policyService.set('DAILY_FREE_ROUND_LIMIT', 3, 'test');

    const res = await adminQuotaRoute.request('/');
    const body = await res.json() as { freeLimit: number; freeLimitOverride: number | null; refresh: { mode: string } };

    expect(res.status).toBe(200);
    expect(body.freeLimitOverride).toBeNull();
    expect(body.freeLimit).toBe(3);
    expect(body.refresh.mode).toBe('daily');
  });

  it('sets a per-user daily quota without changing the global default', async () => {
    policyService.set('DAILY_FREE_ROUND_LIMIT', 3, 'test');

    const res = await adminQuotaRoute.request('/set-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr_one',
        freeLimit: 1,
        bonusLimit: 0,
        reason: 'test per-user quota',
      }),
    });
    expect(res.status).toBe(200);

    expect(getQuotaForDate('usr_one').freeLimit).toBe(1);
    expect(consumeOneRound('usr_one')).toBe(true);
    expect(consumeOneRound('usr_one')).toBe(false);

    expect(getQuotaForDate('usr_two').freeLimit).toBe(3);
    expect(consumeOneRound('usr_two')).toBe(true);
    expect(consumeOneRound('usr_two')).toBe(true);
    expect(consumeOneRound('usr_two')).toBe(true);
    expect(consumeOneRound('usr_two')).toBe(false);
  });

  it('resets only the used counts for a user day', async () => {
    store.state().freeLimitOverride = 1;
    expect(consumeOneRound('usr_reset')).toBe(true);
    expect(consumeOneRound('usr_reset')).toBe(false);

    const res = await adminQuotaRoute.request('/reset-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: 'usr_reset',
        reason: 'test reset',
      }),
    });
    expect(res.status).toBe(200);

    const q = getQuotaForDate('usr_reset');
    expect(q.freeUsed).toBe(0);
    expect(q.freeLimit).toBe(1);
    expect(consumeOneRound('usr_reset')).toBe(true);
  });
});
