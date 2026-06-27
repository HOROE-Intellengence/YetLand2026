import type { CandleState } from '../enums/candle-state';
import type { CandleReason } from '../enums/candle-reason';

export interface CandleBalance {
  balance: number;
  registerGrant: number;
  state: CandleState;
  lastTopupAt: string | null;
}

export interface CandleLedgerEntry {
  id: string;
  delta: number;
  reason: CandleReason;
  refId: string;
  createdAt: string;
}
