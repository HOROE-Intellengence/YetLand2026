import { api } from './client';
import type { Plan, Subscription, CandleBalance, CandleLedgerEntry, ConversationQuota } from '@yelan/shared';

export const listPlans = () => api<Plan[]>('/api/billing/plans');
export const subscribe = (planId: string, cycle: 'week' | 'month') =>
  api<{ paymentUrl: string }>('/api/billing/subscribe', { method: 'POST', body: JSON.stringify({ planId, cycle }) });
export const getMySubscription = () => api<Subscription | null>('/api/billing/subscription');

export const getCandleBalance = () => api<CandleBalance>('/api/billing/candle');
export const getCandleLedger = (params?: { limit?: number; before?: string }) => {
  const q = new URLSearchParams(params as Record<string, string>);
  return api<CandleLedgerEntry[]>(`/api/billing/candle/ledger?${q}`);
};

export const getQuota = () => api<ConversationQuota>('/api/billing/quota');
