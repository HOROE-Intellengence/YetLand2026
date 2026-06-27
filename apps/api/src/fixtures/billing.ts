import type { Plan, Subscription, CandleBalance, CandleLedgerEntry, ConversationQuota } from '@yelan/shared';

export const mockPlans: Plan[] = [
  {
    id: 'moonlight',
    name: '月光',
    tagline: '每周一晚，月光陪你',
    description: '今夜不被免费叙事弧打断，完整走到该停的地方。',
    cycles: { week: 9.9, month: 29.9 },
    cycleDetails: {
      week: { price: 9.9, listPrice: null, discountLabel: '试住一周', candleGrant: 50, enabled: true },
      month: { price: 29.9, listPrice: 39.6, discountLabel: '月省 25%', candleGrant: 200, enabled: true },
    },
    perks: ['不受 20 轮免费截断', '完整叙事弧', '每月 200 烛'],
    active: true,
    featured: false,
    sortOrder: 10,
  },
  {
    id: 'milkyway',
    name: '星河',
    tagline: '每个夜晚，星光随行',
    description: '适合每天回来的人，叙事高光阶段优先走更好的模型。',
    cycles: { week: 19.9, month: 59.9 },
    cycleDetails: {
      week: { price: 19.9, listPrice: null, discountLabel: '深住一周', candleGrant: 150, enabled: true },
      month: { price: 59.9, listPrice: 79.6, discountLabel: '月省 25%', candleGrant: 600, enabled: true },
    },
    perks: ['月光全部权益', '优先叙事模型', '每月 600 烛', '付费回归问候'],
    active: true,
    featured: true,
    sortOrder: 20,
  },
  {
    id: 'eternal',
    name: '永夜',
    tagline: '永远为你亮着',
    description: '深度沉浸用户的保留档，后续新体验优先开放。',
    cycles: { week: 39.9, month: 99.9 },
    cycleDetails: {
      week: { price: 39.9, listPrice: null, discountLabel: '长夜一周', candleGrant: 400, enabled: true },
      month: { price: 99.9, listPrice: 159.6, discountLabel: '月省 37%', candleGrant: 1500, enabled: true },
    },
    perks: ['星河全部权益', '每月 1500 烛', '后续优先体验'],
    active: true,
    featured: false,
    sortOrder: 30,
  },
];

export const mockSubscription: Subscription | null = null;

export const mockCandle: CandleBalance = { balance: 60, registerGrant: 100, state: 'mid', lastTopupAt: null };

export const mockLedger: CandleLedgerEntry[] = [
  { id: 'cl_1', delta: 100, reason: 'register_grant', refId: 'usr_mock_1', createdAt: '2026-05-01T00:00:00Z' },
  { id: 'cl_2', delta: -40, reason: 'unlock_card',   refId: 'jiang-bai',  createdAt: '2026-05-03T13:30:00Z' },
];

export const mockQuota: ConversationQuota = {
  date: new Date().toISOString().slice(0, 10),
  freeLimit: 20, freeUsed: 4, bonusLimit: 0, bonusUsed: 0, membership: false,
};
