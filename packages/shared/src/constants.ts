// 不变的业务常量 — 改这里 = 改产品口径
// 注：可被运营动态调整的项已迁至 policy_kv（apps/api/src/services/policy.ts）。
// 修订 B（2026-05-09）取消成本熔断阈值。
import type { Boundary } from './enums/boundary';

export const DAILY_FREE_ROUND_LIMIT = 20; // 完全免费用户的日对话额度
export const REGISTER_CANDLE_GRANT = 100; // 注册一次性烛
export const DEFAULT_USER_BOUNDARY: Boundary = 3; // 新用户默认叙事边界
export const DEFAULT_GLOBAL_BOUNDARY: Boundary = 3; // 未配置全局合规上限时的默认值
export const SURVEY_MIN_DWELL_SECONDS = 5; // 单题最小停留秒数
export const CONTEXT_COMPRESS_TOKEN_LIMIT = 8000;
export const KEY_SENTENCE_PAUSE_MS = 700;   // 修订 #25：关键句额外停顿（600~800ms）
