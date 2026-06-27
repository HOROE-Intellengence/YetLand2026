// candle_ledger.reason — 写入幂等键依赖于 (reason, refId)
export type CandleReason =
  | 'register_grant'
  | 'favor_trigger'
  | 'passion_trigger'
  | 'daily_greeting'
  | 'achievement'
  | 'survey'
  | 'subscription_grant'
  | 'admin_grant'
  | 'unlock_card'
  | 'image_gen'
  | 'exchange_quota'
  | 'expire';
