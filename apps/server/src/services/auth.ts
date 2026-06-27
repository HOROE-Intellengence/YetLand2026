// ⚠️⚠️⚠️ DEV-MODE ONLY — NOT FOR PRODUCTION ⚠️⚠️⚠️
//
// 本文件的所有函数均为开发期占位实现，存在以下严重安全漏洞，
// 上线前必须全部修复，否则任何人可以冒充任意用户：
//
//   1. sendOtp:    未接入短信网关，OTP 没有真实下发
//   2. verifyOtp:  接受任意 6 位验证码，未校验 OTP 真伪
//   3. createSession: 明文 token (yelan_ + userId)，无签名无过期，
//                  攻击者只需要知道 phone 即可伪造任意用户 token
//
// 修复路线见各函数 TODO 注释。在所有 TODO 清空之前，
// 严禁将 apps/server 切为生产入口。
//
// ⚠️⚠️⚠️ DEV-MODE ONLY — NOT FOR PRODUCTION ⚠️⚠️⚠️

import type { Env } from '../types/bindings';

const TOKEN_PREFIX = 'yelan_';

function generateToken(userId: string): string {
  // TODO(security): 替换为 JWT 签名（HMAC-SHA256 + exp），当前为开发期明文 token
  return `${TOKEN_PREFIX}${userId}`;
}

export async function sendOtp(_env: Env, _phone: string): Promise<void> {
  // TODO(security): 接入短信网关（阿里云/腾讯云），写 KV 5min TTL
  // 当前实现：什么也不做 — 不要在生产使用
}

export async function verifyOtp(
  _env: Env,
  _phone: string,
  _code: string,
): Promise<{ userId: string; isNew: boolean }> {
  // TODO(security): 从 KV 校验 OTP → DB upsert user → 新用户触发 register_grant（蜡烛赠送）
  // ⚠️ 当前实现：接受任意验证码 — 不要在生产使用
  const userId = `usr_${_phone.replace(/\D/g, '')}`;
  return { userId, isNew: true };
}

export async function createSession(_env: Env, userId: string): Promise<{ token: string }> {
  // ⚠️ 当前实现：明文 token，无签名无过期 — 不要在生产使用
  return { token: generateToken(userId) };
}
