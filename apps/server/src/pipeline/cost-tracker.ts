import type { Env } from '../types/bindings';

export interface CostRecord {
  userId: string;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  stage: string;
  sessionId: string;
}

export async function recordCost(env: Env, r: CostRecord): Promise<void> {
  if (env.DB) {
    await env.DB.prepare(
      `INSERT INTO cost_records (user_id, session_id, provider, model, input_tokens, output_tokens, cost_usd, stage)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(r.userId, r.sessionId, r.provider, r.model, r.inputTokens, r.outputTokens, r.costUsd, r.stage)
      .run();
  }
}

export async function todayCost(env: Env, userId: string): Promise<number> {
  if (!env.DB) return 0;
  const today = new Date().toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    `SELECT COALESCE(SUM(cost_usd), 0) as total FROM cost_records
     WHERE user_id = ?1 AND created_at >= ?2`,
  )
    .bind(userId, `${today}T00:00:00Z`)
    .first<{ total: number }>();
  return row?.total ?? 0;
}
