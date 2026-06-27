// 订阅 / 烛账 / 配额（用户视角的查询；写入由 pay 回调或 admin 触发）
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import type { CandleBalance, CandleLedgerEntry, ConversationQuota } from '@yelan/shared';
import { BillingSubscribeRequestSchema } from '@yelan/shared';
import { softAuth } from '../middleware/auth';
import { getCandleLedger, getQuotaToday, getUserById } from '../services/users';
import { activateMembership, currentSubscriptionForUser, hasActiveSubscription, listMembershipPlans } from '../services/membership';
import { validationHook } from '../middleware/validation';

export const mockBillingRoute = new Hono();

mockBillingRoute.get('/plans', (c) => c.json(listMembershipPlans()));

mockBillingRoute.use('/subscription', softAuth());
mockBillingRoute.get('/subscription', (c) => {
  const userId = c.get('userId') as string;
  return c.json(currentSubscriptionForUser(userId));
});

mockBillingRoute.use('/subscribe', softAuth());
mockBillingRoute.post('/subscribe', zValidator('json', BillingSubscribeRequestSchema, validationHook), async (c) => {
  const body = c.req.valid('json');
  const userId = c.get('userId') as string;
  const planId = body.planId ?? 'moonlight';
  const cycle = body.cycle ?? 'month';
  const checkoutId = `mock_checkout_${Date.now()}`;
  const plan = listMembershipPlans({ includeInactive: true }).find((p) => p.id === planId);
  const subscription = activateMembership({
    userId,
    planId,
    cycle,
    provider: 'mock',
    gatewayEventId: checkoutId,
    gatewaySubscriptionId: checkoutId,
    amount: plan?.cycleDetails[cycle].price,
  });
  return c.json({
    paymentUrl: `mock://pay/${planId}/${cycle}/${checkoutId}`,
    checkoutId,
    mock: true,
    subscription,
  });
});

mockBillingRoute.use('/candle', softAuth());
mockBillingRoute.get('/candle', (c) => {
  const userId = c.get('userId') as string;
  const u = getUserById(userId);
  if (!u) return c.json({ code: 'NOT_FOUND', message: 'user not found' }, 404);
  // 与前端 candle-state.ts / 开发文档 §三.3 保持一致的动态公式
  const state: CandleBalance['state'] =
    u.candle > u.registerGrant * 0.5
      ? 'full'
      : u.candle > u.registerGrant * 0.15
        ? 'mid'
        : 'low';
  const balance: CandleBalance = {
    balance: u.candle,
    registerGrant: u.registerGrant,
    state,
    lastTopupAt: null,
  };
  return c.json(balance);
});

mockBillingRoute.use('/candle/ledger', softAuth());
mockBillingRoute.get('/candle/ledger', (c) => {
  const userId = c.get('userId') as string;
  const ledger: CandleLedgerEntry[] = getCandleLedger(userId).map((r) => ({
    id: r.id,
    delta: r.delta,
    reason: r.reason as CandleLedgerEntry['reason'],
    refId: r.refId ?? '',
    createdAt: r.createdAt,
  }));
  return c.json(ledger);
});

mockBillingRoute.use('/quota', softAuth());
mockBillingRoute.get('/quota', (c) => {
  const userId = c.get('userId') as string;
  const q = getQuotaToday(userId);
  const out: ConversationQuota = {
    date: q.date,
    freeLimit: q.freeLimit,
    freeUsed: q.freeUsed,
    bonusLimit: q.bonusLimit,
    bonusUsed: q.bonusUsed,
    // 会员绕过闸门，前端据此展示「不限」。与 consumeOneRound 的会员判定同源。
    membership: hasActiveSubscription(userId),
  };
  return c.json(out);
});
