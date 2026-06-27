// 烛账 / 光态 — 余额从 server 拉，光态在前端派生
import { create } from 'zustand';
import { candleState } from '../lib/candle-state';
import type { CandleState } from '@yelan/shared';

interface CandleStoreState {
  balance: number;
  registerGrant: number;
  state: CandleState;
  setBalance: (n: number, registerGrant?: number) => void;
}

export const useCandleStore = create<CandleStoreState>((set) => ({
  balance: 0,
  registerGrant: 100, // server 下发后覆盖
  state: 'full',
  setBalance: (balance, registerGrant) =>
    set((prev) => {
      const grant = registerGrant ?? prev.registerGrant;
      return { balance, registerGrant: grant, state: candleState(balance, grant) };
    }),
}));
