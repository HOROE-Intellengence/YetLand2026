import { beforeEach, describe, expect, it } from 'vitest';
import { mockBillingRoute } from '../routes/billing';
import { adminMembershipRoute } from '../routes/admin/membership';
import { store } from '../store/persistence';
import { consumeOneRound, getQuotaForDate } from '../services/users';
import {
  activateMembership,
  currentSubscriptionForUser,
  hasActiveSubscription,
} from '../services/membership';

function makeUser() {
  const id = 'usr_member_test';
  const token = 'tok_member_test';
  const s = store.state();
  s.users[id] = {
    id,
    phone: '13900000001',
    token,
    ageVerified: true,
    narrativeBoundary: 3,
    ifUnlocked: false,
    createdAt: new Date().toISOString(),
    candle: 100,
    registerGrant: 100,
    conversationRounds: 0,
  };
  s.tokenIndex[token] = id;
  s.phoneIndex['13900000001'] = id;
  store.save();
  return { id, token };
}

function userHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

describe('membership mock flow', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('returns editable default membership plans', async () => {
    const res = await mockBillingRoute.request('/plans');
    expect(res.status).toBe(200);
    const plans = await res.json() as { id: string; cycleDetails: { month: { price: number; candleGrant: number } } }[];
    expect(plans.map((p) => p.id)).toEqual(['moonlight', 'milkyway', 'eternal']);
    const firstPlan = plans[0]!;
    expect(firstPlan.cycleDetails.month.price).toBe(29.9);
    expect(firstPlan.cycleDetails.month.candleGrant).toBe(200);
  });

  it('activates a mock subscription and grants subscription candles', async () => {
    const { id, token } = makeUser();
    const res = await mockBillingRoute.request('/subscribe', {
      method: 'POST',
      headers: userHeaders(token),
      body: JSON.stringify({ planId: 'milkyway', cycle: 'month' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { mock?: boolean; subscription?: { plan: string } };
    expect(body.mock).toBe(true);
    expect(body.subscription?.plan).toBe('milkyway');
    expect(store.state().users[id]!.candle).toBe(700);
    expect(store.state().candleLedger.some((row) => row.reason === 'subscription_grant' && row.delta === 600)).toBe(true);
  });

  it('does not duplicate subscriptions or candle grants for the same gateway event', () => {
    const { id } = makeUser();
    const first = activateMembership({
      userId: id,
      planId: 'milkyway',
      cycle: 'week',
      provider: 'mock',
      gatewayEventId: 'evt_membership_once',
      gatewaySubscriptionId: 'gw_membership_once',
      amount: 19.9,
    });
    const second = activateMembership({
      userId: id,
      planId: 'milkyway',
      cycle: 'week',
      provider: 'mock',
      gatewayEventId: 'evt_membership_once',
      gatewaySubscriptionId: 'gw_membership_once',
      amount: 19.9,
    });

    expect(second.id).toBe(first.id);
    expect(first.amount).toBe(19.9);
    expect(store.state().users[id]!.candle).toBe(250);
    const grants = store.state().candleLedger.filter((row) => row.reason === 'subscription_grant');
    expect(grants).toHaveLength(1);
    expect(grants[0]!.delta).toBe(150);
  });

  it('flips /quota membership flag from false to true after subscribing', async () => {
    const { id, token } = makeUser();

    // 充值前：免费额度耗尽，membership=false（前端会显示有限分母）
    const q = getQuotaForDate(id);
    store.state().quota[id]![q.date]!.freeUsed = q.freeLimit;
    store.save();

    const before = await mockBillingRoute.request('/quota', { headers: userHeaders(token) });
    const beforeBody = await before.json() as { membership: boolean; freeUsed: number; freeLimit: number };
    expect(beforeBody.membership).toBe(false);
    expect(beforeBody.freeUsed).toBe(beforeBody.freeLimit);

    await mockBillingRoute.request('/subscribe', {
      method: 'POST',
      headers: userHeaders(token),
      body: JSON.stringify({ planId: 'moonlight', cycle: 'month' }),
    });

    // 充值后：membership=true → 前端据此展示「会员·不限」，无需刷新页面即可拉到新态
    const after = await mockBillingRoute.request('/quota', { headers: userHeaders(token) });
    const afterBody = await after.json() as { membership: boolean };
    expect(afterBody.membership).toBe(true);
    // 会员绕闸门：免费额度仍耗尽，但 consumeOneRound 放行
    expect(consumeOneRound(id)).toBe(true);
  });

  it('lets active members pass the daily free quota guard', async () => {
    const { id, token } = makeUser();
    const q = getQuotaForDate(id);
    store.state().quota[id]![q.date]!.freeUsed = q.freeLimit;
    store.save();

    expect(consumeOneRound(id)).toBe(false);

    await mockBillingRoute.request('/subscribe', {
      method: 'POST',
      headers: userHeaders(token),
      body: JSON.stringify({ planId: 'moonlight', cycle: 'week' }),
    });

    expect(consumeOneRound(id)).toBe(true);
  });

  it('uses one active-membership predicate for billing and quota even with newer canceled rows', () => {
    const { id } = makeUser();
    const q = getQuotaForDate(id);
    store.state().quota[id]![q.date]!.freeUsed = q.freeLimit;
    const future = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    store.state().subscriptions.sub_old_active = {
      id: 'sub_old_active',
      userId: id,
      plan: 'moonlight',
      cycle: 'week',
      status: 'active',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: future,
      cancelAtPeriodEnd: false,
      gatewaySubscriptionId: null,
      provider: 'mock',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    store.state().subscriptions.sub_new_canceled = {
      id: 'sub_new_canceled',
      userId: id,
      plan: 'eternal',
      cycle: 'month',
      status: 'canceled',
      currentPeriodStart: new Date().toISOString(),
      currentPeriodEnd: future,
      cancelAtPeriodEnd: false,
      gatewaySubscriptionId: null,
      provider: 'mock',
      createdAt: '2026-05-02T00:00:00.000Z',
      updatedAt: '2026-05-02T00:00:00.000Z',
    };
    store.save();

    expect(hasActiveSubscription(id)).toBe(true);
    expect(currentSubscriptionForUser(id)?.id).toBe('sub_old_active');
    expect(consumeOneRound(id)).toBe(true);
    expect(store.state().quota[id]![q.date]!.freeUsed).toBe(q.freeLimit);
  });

  it('marks expired subscriptions past_due before billing and quota entitlement checks', () => {
    const { id } = makeUser();
    const q = getQuotaForDate(id);
    store.state().quota[id]![q.date]!.freeUsed = q.freeLimit;
    store.state().subscriptions.sub_expired = {
      id: 'sub_expired',
      userId: id,
      plan: 'moonlight',
      cycle: 'week',
      status: 'active',
      currentPeriodStart: '2026-05-01T00:00:00.000Z',
      currentPeriodEnd: '2026-05-02T00:00:00.000Z',
      cancelAtPeriodEnd: false,
      gatewaySubscriptionId: null,
      provider: 'mock',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    };
    store.save();

    expect(currentSubscriptionForUser(id)).toBeNull();
    expect(store.state().subscriptions.sub_expired!.status).toBe('past_due');
    expect(hasActiveSubscription(id)).toBe(false);
    expect(consumeOneRound(id)).toBe(false);
  });

  it('updates plan price and candle grant through the admin route', async () => {
    const res = await adminMembershipRoute.request('/plans/moonlight', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        cycleDetails: { month: { price: 19.9, candleGrant: 260, discountLabel: '灰测价' } },
        reason: 'test membership pricing',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { plan: { cycleDetails: { month: { price: number; candleGrant: number; discountLabel: string } } } };
    expect(body.plan.cycleDetails.month.price).toBe(19.9);
    expect(body.plan.cycleDetails.month.candleGrant).toBe(260);
    expect(body.plan.cycleDetails.month.discountLabel).toBe('灰测价');
  });

  it('grants and cancels memberships through the admin route', async () => {
    const { id } = makeUser();
    const grantRes = await adminMembershipRoute.request('/grant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: id,
        planId: 'eternal',
        cycle: 'week',
        periodDays: 14,
        candleGrantOverride: 33,
        reason: 'test manual membership grant',
      }),
    });
    expect(grantRes.status).toBe(200);
    const grantBody = await grantRes.json() as { subscription: { plan: string; cycle: string; status: string } };
    expect(grantBody.subscription).toMatchObject({ plan: 'eternal', cycle: 'week', status: 'active' });
    expect(store.state().users[id]!.candle).toBe(133);
    expect(currentSubscriptionForUser(id)?.plan).toBe('eternal');

    const cancelLaterRes = await adminMembershipRoute.request('/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: id,
        reason: 'test cancel at period end',
      }),
    });
    expect(cancelLaterRes.status).toBe(200);
    const cancelLaterBody = await cancelLaterRes.json() as { subscription: { status: string; cancelAtPeriodEnd: boolean } };
    expect(cancelLaterBody.subscription.status).toBe('active');
    expect(cancelLaterBody.subscription.cancelAtPeriodEnd).toBe(true);
    expect(hasActiveSubscription(id)).toBe(true);

    const cancelNowRes = await adminMembershipRoute.request('/cancel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: id,
        immediate: true,
        reason: 'test immediate cancel',
      }),
    });
    expect(cancelNowRes.status).toBe(200);
    const cancelNowBody = await cancelNowRes.json() as { subscription: { status: string; cancelAtPeriodEnd: boolean } };
    expect(cancelNowBody.subscription.status).toBe('canceled');
    expect(cancelNowBody.subscription.cancelAtPeriodEnd).toBe(false);
    expect(currentSubscriptionForUser(id)).toBeNull();
  });
});
