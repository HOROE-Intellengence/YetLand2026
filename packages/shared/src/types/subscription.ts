import type { SubscriptionPlanId, SubscriptionCycle, SubscriptionStatus } from '../enums/subscription-plan';

export interface PlanCycleConfig {
  price: number;
  listPrice: number | null;
  discountLabel: string;
  candleGrant: number;
  enabled: boolean;
}

export interface Plan {
  id: SubscriptionPlanId;
  name: string;
  tagline?: string;
  description?: string;
  cycles: Record<SubscriptionCycle, number>; // 兼容旧 UI 的最终价格（元）
  cycleDetails: Record<SubscriptionCycle, PlanCycleConfig>;
  perks: string[];
  active: boolean;
  featured?: boolean;
  sortOrder: number;
}

export interface Subscription {
  id: string;
  userId: string;
  plan: SubscriptionPlanId;
  cycle: SubscriptionCycle;
  status: SubscriptionStatus;
  currentPeriodStart?: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd?: boolean;
  gatewaySubscriptionId: string | null;
  provider?: string;
  amount?: number;
}
