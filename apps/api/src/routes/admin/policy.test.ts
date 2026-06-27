import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../store/persistence';
import { clearPolicyCache, policyService } from '../../services/policy';
import { adminPolicyRoute } from './policy';

describe('admin policy route', () => {
  beforeEach(() => {
    store.__resetForTests();
    clearPolicyCache();
  });

  it('returns validation errors with a stable shape', async () => {
    const res = await adminPolicyRoute.request('/DAILY_FREE_ROUND_LIMIT', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 1 }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('updates a policy with a valid body', async () => {
    const res = await adminPolicyRoute.request('/DAILY_FREE_ROUND_LIMIT', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 2, reason: 'test' }),
    });

    expect(res.status).toBe(200);
    expect(policyService.get('DAILY_FREE_ROUND_LIMIT', 20)).toBe(2);
  });

  it('rejects unknown policy keys', async () => {
    const res = await adminPolicyRoute.request('/UNKNOWN_POLICY', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 2, reason: 'test' }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'UNKNOWN_POLICY_KEY' });
  });
});
