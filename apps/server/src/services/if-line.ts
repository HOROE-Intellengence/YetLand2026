// IF 线 — 暗号兑换 / 状态机 / 后台标记
// 关键: 任何兑换都必须写 user_flags(if_unlocked=true, if_source)
import type { Env } from '../types/bindings';
import type { IfUnlockState } from '@yelan/shared';

export async function redeemCode(_env: Env, _userId: string, _code: string): Promise<{ accepted: boolean; state: IfUnlockState }> {
  // 1. 取 code_hash 查 if_codes
  // 2. 校验 valid_until + max_redemptions
  // 3. 写 if_unlocks + user_flags
  // 4. 不返回任何"解锁成功"的显式信号；前端在下一轮 chat 自然进入
  return { accepted: false, state: 'locked' };
}
