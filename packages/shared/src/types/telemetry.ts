// 埋点最小集 — 见开发文档 §三.6
export type TelemetryEventName =
  | 'user_open'
  | 'conversation_start'
  | 'conversation_message'
  | 'conversation_log_uploaded'
  | 'achievement_unlocked'
  | 'candle_state_change'
  | 'narrative_cutoff'
  | 'subscription_view'
  | 'subscription_purchase'
  | 'drawer_open'
  | 'user_feedback'
  | 'sse_error'
  | 'api_error'
  | 'exit';

export interface TelemetryEvent {
  name: TelemetryEventName;
  ts: number;
  payload?: Record<string, unknown>;
}
