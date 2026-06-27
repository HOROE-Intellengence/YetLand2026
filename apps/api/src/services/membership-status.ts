import type { SubscriptionRow } from '../store/persistence';

const ENTITLED_STATUSES = new Set(['active', 'grace']);

export function refreshExpiredMembershipRows(
  subscriptions: Record<string, SubscriptionRow>,
  nowMs = Date.now(),
): boolean {
  const updatedAt = new Date(nowMs).toISOString();
  let dirty = false;
  for (const sub of Object.values(subscriptions)) {
    if (ENTITLED_STATUSES.has(sub.status) && Date.parse(sub.currentPeriodEnd) <= nowMs) {
      sub.status = 'past_due';
      sub.updatedAt = updatedAt;
      dirty = true;
    }
  }
  return dirty;
}

export function getActiveMembershipRow(
  subscriptions: Record<string, SubscriptionRow>,
  userId: string,
  nowMs = Date.now(),
): SubscriptionRow | null {
  return Object.values(subscriptions)
    .filter(
      (sub) =>
        sub.userId === userId &&
        ENTITLED_STATUSES.has(sub.status) &&
        Date.parse(sub.currentPeriodEnd) > nowMs,
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

export function hasActiveMembershipRow(
  subscriptions: Record<string, SubscriptionRow>,
  userId: string,
  nowMs = Date.now(),
): boolean {
  return getActiveMembershipRow(subscriptions, userId, nowMs) !== null;
}
