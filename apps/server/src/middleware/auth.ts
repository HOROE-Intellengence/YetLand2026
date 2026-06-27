// ⚠️⚠️⚠️ DEV-MODE ONLY — NOT FOR PRODUCTION ⚠️⚠️⚠️
//
// 本 middleware 的 token 校验仅为开发期占位：明文前缀 + userId，
// 没有签名、没有过期、没有撤销机制。任何知道 yelan_<userId> 格式的人
// 都可以伪造任意用户的请求。配套的 services/auth.ts 同样是 dev-mode。
//
// 上线前必须替换为 JWT (HMAC-SHA256 + exp + refresh) 或等价方案。
//
// ⚠️⚠️⚠️ DEV-MODE ONLY — NOT FOR PRODUCTION ⚠️⚠️⚠️

import type { MiddlewareHandler } from 'hono';
import { AppError } from './error';

const TOKEN_PREFIX = 'yelan_';

function userIdFromToken(token: string): string | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const payload = token.slice(TOKEN_PREFIX.length);
  // TODO(security): 替换为 JWT 签名校验（HMAC-SHA256），当前为开发期明文 token
  if (!payload || payload.length < 4) return null;
  return payload;
}

export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) throw new AppError(401, 'AUTH_REQUIRED', 'auth required');

    const userId = userIdFromToken(token);
    if (!userId) throw new AppError(401, 'AUTH_INVALID', 'invalid token');

    c.set('userId', userId);
    await next();
  };
}
