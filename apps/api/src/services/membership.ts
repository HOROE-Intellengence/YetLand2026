import { randomUUID } from 'node:crypto';
import type { Plan, PlanCycleConfig, Subscription, SubscriptionCycle, SubscriptionPlanId } from '@yelan/shared';
import { mockPlans } from '../fixtures/billing';
import { store, type MembershipPlanRow, type SubscriptionRow } from '../store/persistence';
import { adjustCandle, getUserById } from './users';
import { getActiveMembershipRow, hasActiveMembershipRow, refreshExpiredMembershipRows } from './membership-status';

const PLAN_IDS: SubscriptionPlanId[] = ['moonlight', 'milkyway', 'eternal'];

function nowIso(): string {
  return new Date().toISOString();
}

function addDays(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function periodDays(cycle: SubscriptionCycle): number {
  return cycle === 'week' ? 7 : 30;
}

function normalizePlan(plan: Plan): MembershipPlanRow {
  return {
    ...plan,
    cycles: {
      week: plan.cycleDetails.week.price,
      month: plan.cycleDetails.month.price,
    },
    active: plan.active !== false,
    sortOrder: plan.sortOrder ?? 999,
  };
}

export function ensureMembershipPlans(): Record<string, MembershipPlanRow> {
  const s = store.state();
  let dirty = false;
  for (const plan of mockPlans) {
    const existing = s.membershipPlans[plan.id];
    if (!existing) {
      s.membershipPlans[plan.id] = normalizePlan(plan);
      dirty = true;
      continue;
    }
    const merged = normalizePlan({
      ...plan,
      ...existing,
      cycleDetails: {
        week: { ...plan.cycleDetails.week, ...existing.cycleDetails?.week },
        month: { ...plan.cycleDetails.month, ...existing.cycleDetails?.month },
      },
      perks: existing.perks ?? plan.perks,
    });
    s.membershipPlans[plan.id] = merged;
  }
  if (dirty) store.save();
  return s.membershipPlans;
}

export function listMembershipPlans(options?: { includeInactive?: boolean }): MembershipPlanRow[] {
  const plans = ensureMembershipPlans();
  return PLAN_IDS
    .map((id) => plans[id])
    .filter((p): p is MembershipPlanRow => Boolean(p))
    .filter((p) => options?.includeInactive || p.active)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function getMembershipPlan(planId: SubscriptionPlanId): MembershipPlanRow | null {
  return ensureMembershipPlans()[planId] ?? null;
}

type MembershipPlanPatch = Omit<Partial<MembershipPlanRow>, 'cycleDetails'> & {
  cycleDetails?: Partial<Record<SubscriptionCycle, Partial<PlanCycleConfig>>>;
};

export function patchMembershipPlan(planId: SubscriptionPlanId, patch: MembershipPlanPatch): MembershipPlanRow {
  const s = store.state();
  const current = getMembershipPlan(planId);
  if (!current) throw new Error(`unknown membership plan: ${planId}`);
  const next: MembershipPlanRow = normalizePlan({
    ...current,
    ...patch,
    id: planId,
    cycleDetails: {
      week: { ...current.cycleDetails.week, ...patch.cycleDetails?.week },
      month: { ...current.cycleDetails.month, ...patch.cycleDetails?.month },
    },
    perks: patch.perks ?? current.perks,
  });
  s.membershipPlans[planId] = next;
  store.save();
  return next;
}

function publicSubscription(row: SubscriptionRow): Subscription {
  return {
    id: row.id,
    userId: row.userId,
    plan: row.plan,
    cycle: row.cycle,
    status: row.status,
    currentPeriodStart: row.currentPeriodStart,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
    gatewaySubscriptionId: row.gatewaySubscriptionId,
    provider: row.provider,
    amount: row.amount,
  };
}

export function currentSubscriptionForUser(userId: string): Subscription | null {
  const s = store.state();
  const now = Date.now();
  const dirty = refreshExpiredMembershipRows(s.subscriptions, now);
  const current = getActiveMembershipRow(s.subscriptions, userId, now);
  if (dirty) store.save();
  if (!current) return null;
  return publicSubscription(current);
}

export function listSubscriptions(): SubscriptionRow[] {
  return Object.values(store.state().subscriptions).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function hasActiveSubscription(userId: string): boolean {
  const s = store.state();
  const now = Date.now();
  const dirty = refreshExpiredMembershipRows(s.subscriptions, now);
  const active = hasActiveMembershipRow(s.subscriptions, userId, now);
  if (dirty) store.save();
  return active;
}

export function activateMembership(input: {
  userId: string;
  planId: SubscriptionPlanId;
  cycle: SubscriptionCycle;
  provider: string;
  gatewayEventId?: string;
  gatewaySubscriptionId?: string | null;
  amount?: number;
  periodDays?: number;
  candleGrantOverride?: number;
}): Subscription {
  const user = getUserById(input.userId);
  if (!user) throw new Error(`user ${input.userId} not found`);
  const plan = getMembershipPlan(input.planId);
  if (!plan || !plan.active) throw new Error(`membership plan ${input.planId} is not active`);
  const cycle = plan.cycleDetails[input.cycle];
  if (!cycle.enabled) throw new Error(`membership plan ${input.planId}/${input.cycle} is disabled`);

  const s = store.state();
  if (input.gatewayEventId) {
    const existing = Object.values(s.subscriptions).find((sub) => sub.gatewayEventId === input.gatewayEventId);
    if (existing) return publicSubscription(existing);
  }

  const ts = nowIso();
  const id = `sub_${randomUUID().slice(0, 10)}`;
  const row: SubscriptionRow = {
    id,
    userId: input.userId,
    plan: input.planId,
    cycle: input.cycle,
    status: 'active',
    currentPeriodStart: ts,
    currentPeriodEnd: addDays(input.periodDays ?? periodDays(input.cycle)),
    cancelAtPeriodEnd: false,
    gatewaySubscriptionId: input.gatewaySubscriptionId ?? null,
    gatewayEventId: input.gatewayEventId,
    provider: input.provider,
    amount: input.amount,
    createdAt: ts,
    updatedAt: ts,
  };
  s.subscriptions[id] = row;

  const candleGrant = input.candleGrantOverride ?? cycle.candleGrant;
  const candleRef = `subscription:${input.gatewayEventId ?? id}:${input.cycle}`;
  if (candleGrant > 0 && !s.candleLedger.some((r) => r.userId === input.userId && r.reason === 'subscription_grant' && r.refId === candleRef)) {
    adjustCandle(input.userId, candleGrant, 'subscription_grant', candleRef);
  } else {
    store.save();
  }

  return publicSubscription(row);
}

export function cancelMembership(userId: string, options?: { immediate?: boolean }): Subscription | null {
  const s = store.state();
  const current = Object.values(s.subscriptions)
    .filter((sub) => sub.userId === userId && (sub.status === 'active' || sub.status === 'grace'))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (!current) return null;
  current.cancelAtPeriodEnd = !options?.immediate;
  if (options?.immediate) {
    current.status = 'canceled';
    current.currentPeriodEnd = nowIso();
  }
  current.updatedAt = nowIso();
  store.save();
  return publicSubscription(current);
}
