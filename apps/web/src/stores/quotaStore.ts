// 对话额度 — 当前免费 20 轮 / 已用 / 截断阈值
import { create } from 'zustand';

interface QuotaStoreState {
  freeLimit: number;       // 默认 20
  freeUsed: number;
  bonusLimit: number;
  bonusUsed: number;
  membership: boolean;     // 会员绕过额度闸门 → UI 展示「不限」
  setFromServer: (q: { freeLimit: number; freeUsed: number; bonusLimit: number; bonusUsed: number; membership: boolean }) => void;
  incrementUsed: () => void;
}

export const useQuotaStore = create<QuotaStoreState>((set) => ({
  freeLimit: 20,
  freeUsed: 0,
  bonusLimit: 0,
  bonusUsed: 0,
  membership: false,
  // 会员不消耗 free/bonus，自增计数对会员无意义，故仅在非会员时累加。
  setFromServer: (q) => set(q),
  incrementUsed: () => set((s) => (s.membership ? s : { freeUsed: Math.min(s.freeUsed + 1, s.freeLimit) })),
}));
