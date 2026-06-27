// ⚠️⚠️⚠️ DEV-MODE ONLY — NOT FOR PRODUCTION ⚠️⚠️⚠️
//
// 本文件的所有函数均为开发期占位实现，未做任何真实的余额/额度检查：
//
//   1. grantCandle:      返回 {applied:true, balance:0}，没有真实赠送也没有幂等检查，
//                        攻击者重放 refId 也"成功"，但实际余额没动
//   2. consumeQuota:     永远返回 {ok:true, remaining:19}，等同于无限免费聊天 — 财务黑洞
//   3. getCandleBalance: 永远返回 0，前端看到的余额是假的
//
// 修复路线见各函数 TODO 注释。在所有 TODO 清空之前，
// 严禁将 apps/server 切为生产入口。
//
// ⚠️⚠️⚠️ DEV-MODE ONLY — NOT FOR PRODUCTION ⚠️⚠️⚠️

import type { Env } from '../types/bindings';
import type { CandleReason, QuotaReason } from '@yelan/shared';

export interface CandleGrantInput {
  userId: string;
  delta: number;
  reason: CandleReason;
  refId: string;
  note?: string;
}

export async function grantCandle(
  _env: Env,
  _input: CandleGrantInput,
): Promise<{ applied: boolean; balance?: number }> {
  // TODO(billing): D1 事务 — INSERT ON CONFLICT (user_id, reason, ref_id) DO NOTHING
  //       → UPDATE candle_balance SET balance = balance + delta
  //       → INSERT candle_ledger
  // ⚠️ 当前实现：返回假成功 — 不要在生产使用
  return { applied: true, balance: 0 };
}

export async function consumeQuota(
  _env: Env,
  _userId: string,
  _reason: QuotaReason,
): Promise<{ ok: boolean; remaining: number }> {
  // TODO(billing): D1 事务 — 查 conversation_quota → 扣 free_round_used 或 bonus_round_used
  // ⚠️ 当前实现：永远放行 — 不要在生产使用（会被薅羊毛到破产）
  return { ok: true, remaining: 19 };
}

export async function getCandleBalance(_env: Env, _userId: string): Promise<number> {
  // TODO(billing): D1 查询 candle_balance
  // ⚠️ 当前实现：永远返回 0 — 不要在生产使用
  return 0;
}
