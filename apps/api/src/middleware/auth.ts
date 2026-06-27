// 极简鉴权 — 从 Authorization Bearer 取 token，对应 user 写到 ctx
// 与生产的 apps/server/src/middleware/auth.ts 接口一致：c.set('userId')
// softAuth：未带 token 时自动创建/复用匿名 user（让"输入 API key 直接对话"成立）
import type { MiddlewareHandler } from 'hono';
import { getUserByToken, getOrCreateUserByPhone, parseTokenVersion } from '../services/users';

export const ANON_PHONE = '00000000000';

/**
 * 双重失效检查：tokenVersion 比 user.tokenVersion 旧 → token 已被撤销；deletedAt → 账号已注销。
 * 返回 true 表示 token 应被拒绝。
 */
function shouldRejectToken(token: string, user: { tokenVersion?: number; deletedAt?: string }): boolean {
  if (user.deletedAt) return true;
  const v = parseTokenVersion(token);
  const current = user.tokenVersion ?? 0;
  return v < current;
}

export function requireAuth(): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return c.json({ code: 'AUTH_REQUIRED', message: 'auth required' }, 401);
    }
    const user = getUserByToken(token);
    if (!user) {
      return c.json({ code: 'AUTH_INVALID', message: 'invalid token' }, 401);
    }
    if (shouldRejectToken(token, user)) {
      return c.json({ code: 'AUTH_EXPIRED', message: 'token revoked or account deleted' }, 401);
    }
    c.set('userId', user.id);
    c.set('user', user);
    await next();
  };
}

/** 软鉴权：有 token 就用；没 token 时自动落到匿名 user（仅本地 apps/api 用） */
export function softAuth(): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    let user = token ? getUserByToken(token) : null;
    // 已失效的 token 视为无 token（不要 fail，让匿名 user 接管，避免抽屉/偏好查询挂掉）
    if (user && shouldRejectToken(token!, user)) user = null;
    if (!user) {
      user = getOrCreateUserByPhone(ANON_PHONE);
    }
    c.set('userId', user.id);
    c.set('user', user);
    await next();
  };
}

/** 后台 admin token — 走环境变量 ADMIN_TOKEN */
export function requireAdmin(): MiddlewareHandler {
  return async (c, next) => {
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    const expected = process.env.ADMIN_TOKEN || 'admin-dev-token';
    if (!token || token !== expected) {
      return c.json({ code: 'ADMIN_AUTH_REQUIRED', message: 'admin token required' }, 401);
    }
    if (expected === 'admin-dev-token') {
      const incoming = (c.env as Record<string, unknown>).incoming as
        | { socket?: { remoteAddress?: string } }
        | undefined;
      const ip = incoming?.socket?.remoteAddress ?? '';
      const isLocal = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
      if (!isLocal) {
        return c.json(
          { code: 'ADMIN_AUTH_LOCAL_ONLY', message: '默认 admin token 仅限本机使用' },
          403,
        );
      }
    }
    c.set('actor', 'admin');
    await next();
  };
}
