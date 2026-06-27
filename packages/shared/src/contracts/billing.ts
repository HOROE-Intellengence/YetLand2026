import { z } from 'zod';

// ── Plans ──
const BillingPlanCycleSchema = z.object({
  price: z.number(),
  listPrice: z.number().nullable(),
  discountLabel: z.string(),
  candleGrant: z.number().int(),
  enabled: z.boolean(),
});

export const BillingPlansResponseSchema = z.array(z.object({
  id: z.string(),
  name: z.string(),
  tagline: z.string().optional(),
  description: z.string().optional(),
  cycles: z.record(z.enum(['week', 'month']), z.number()),
  cycleDetails: z.record(z.enum(['week', 'month']), BillingPlanCycleSchema),
  perks: z.array(z.string()),
  active: z.boolean(),
  featured: z.boolean().optional(),
  sortOrder: z.number(),
}));

// ── Subscription ──
export const BillingSubscriptionResponseSchema = z.object({
  id: z.string().optional(),
  plan: z.string().optional(),
  planId: z.string().optional(),
  cycle: z.string().optional(),
  status: z.string(),
  currentPeriodStart: z.string().optional(),
  currentPeriodEnd: z.string().nullable().optional(),
  cancelAtPeriodEnd: z.boolean().optional(),
  userId: z.string().optional(),
  gatewaySubscriptionId: z.string().nullable().optional(),
  provider: z.string().optional(),
  amount: z.number().optional(),
});

// ── Subscribe ──
export const BillingSubscribeRequestSchema = z.object({
  planId: z.enum(['moonlight', 'milkyway', 'eternal']).optional(),
  cycle: z.enum(['week', 'month']).optional(),
});

export const BillingSubscribeResponseSchema = z.object({
  paymentUrl: z.string(),
  checkoutId: z.string().optional(),
  mock: z.boolean().optional(),
  subscription: BillingSubscriptionResponseSchema.optional(),
});

// ── Candle ──
export const BillingCandleResponseSchema = z.object({
  balance: z.number(),
  registerGrant: z.number(),
  state: z.enum(['full', 'mid', 'low']),
  lastTopupAt: z.string().nullable(),
});

// ── Candle Ledger ──
export const BillingCandleLedgerResponseSchema = z.array(z.object({
  id: z.string(),
  delta: z.number(),
  reason: z.string(),
  refId: z.string(),
  createdAt: z.string(),
}));

// ── Quota ──
export const BillingQuotaResponseSchema = z.object({
  date: z.string(),
  freeLimit: z.number(),
  freeUsed: z.number(),
  bonusLimit: z.number(),
  bonusUsed: z.number(),
});

export type BillingPlansResponse = z.infer<typeof BillingPlansResponseSchema>;
export type BillingSubscriptionResponse = z.infer<typeof BillingSubscriptionResponseSchema>;
export type BillingSubscribeRequest = z.infer<typeof BillingSubscribeRequestSchema>;
export type BillingSubscribeResponse = z.infer<typeof BillingSubscribeResponseSchema>;
export type BillingCandleResponse = z.infer<typeof BillingCandleResponseSchema>;
export type BillingCandleLedgerResponse = z.infer<typeof BillingCandleLedgerResponseSchema>;
export type BillingQuotaResponse = z.infer<typeof BillingQuotaResponseSchema>;
