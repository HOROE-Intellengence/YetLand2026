// 共享：mock 支付成功 → 写支付记录 + 烛账
import { randomUUID } from 'node:crypto';
import type { SubscriptionCycle, SubscriptionPlanId } from '@yelan/shared';
import { store } from '../../store/persistence';
import { adjustCandle } from '../../services/users';
import { activateMembership } from '../../services/membership';

export interface MockPayBody {
  userId?: string;
  planId?: string;
  cycle?: string;
  amount?: number;
  candleTopup?: number;
  gatewayEventId?: string;
}

export function processMockPay(provider: string, body: MockPayBody) {
  const id = body.gatewayEventId ?? `pay_${randomUUID().slice(0, 8)}`;
  const s = store.state();
  if (s.payments.find((p) => p.id === id)) {
    return { ok: true, idempotent: true };
  }
  s.payments.push({
    id,
    provider,
    userId: body.userId ?? 'unknown',
    amount: body.amount ?? 0,
    status: 'active',
    ts: new Date().toISOString(),
  });
  if (body.userId && body.planId && (body.cycle === 'week' || body.cycle === 'month')) {
    try {
      activateMembership({
        userId: body.userId,
        planId: body.planId as SubscriptionPlanId,
        cycle: body.cycle as SubscriptionCycle,
        provider,
        gatewayEventId: id,
        gatewaySubscriptionId: id,
        amount: body.amount,
      });
    } catch {
      /* keep mock pay callback side-effect free on bad test payloads */
    }
  }
  if (body.userId && body.candleTopup) {
    try {
      adjustCandle(body.userId, body.candleTopup, 'admin_grant', `pay:${provider}:${id}`);
    } catch {
      /* ignore */
    }
  }
  store.save();
  return { ok: true };
}
