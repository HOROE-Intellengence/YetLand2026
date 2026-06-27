// 成就引擎 — Phase 1 默认 5 个：执念 / 告白 / 旧识 / 深夜 / 离别
// 触发: 在 handle-chat-turn 流式结束后异步评估
// 幂等: UNIQUE(user_id, achievement_id)
import type { Env } from '../types/bindings';

export interface AchievementContext {
  userId: string;
  sessionId: string;
  triggerMessageId: string;
  // ... 触发上下文（连续轮次、关键词命中、记忆召回结果、当前小时等）
}

export async function evaluateAchievements(_env: Env, _ctx: AchievementContext): Promise<string[]> {
  // returns 触发的 achievement slug 数组（用于 SSE 推送给前端 + 发烛）
  return [];
}
