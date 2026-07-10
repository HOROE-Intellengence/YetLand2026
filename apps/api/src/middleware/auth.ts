// 极简鉴权 — 从 Authorization Bearer 取 token，对应 user 写到 ctx
// 与生产的 apps/server/src/middleware/auth.ts 接口一致：c.set('userId')
// softAuth：未带 token 时自动创建/复用「每浏览器独立」的游客 user（让"输入 API key 直接对话"成立）
import type { MiddlewareHandler } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { randomUUID } from 'node:crypto';
import { getUserByToken, getOrCreateGuestByDevice, parseTokenVersion } from '../services/users';
import { getDeployMode } from '../config/deploy-mode';

export const ANON_PHONE = '00000000000';

// 匿名访客兜底 id 的 cookie 名。X-Device-Id 头缺失时（无痕/清缓存/非官方客户端），
// 用这个 httpOnly cookie 给每个浏览器一个稳定唯一 id —— 而不是把所有人挤进共享匿名号。
const ANON_COOKIE = 'yl_anon';
const ANON_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 年

/**
 * 取「稳定的匿名身份 id」，优先级：
 *   1. X-Device-Id 头（官方客户端 localStorage UUID，见 apps/web client.ts）
 *   2. yl_anon cookie（服务端签发，补 header 缺失的缺口）
 *   3. 当场种一个新的并 Set-Cookie
 * 返回的 id 交给 getOrCreateGuestByDevice → 每浏览器一条独立游客行，后台可留痕、可迁移。
 * 彻底取代旧的「回落到共享 ANON_PHONE」——那会把不同访客串到同一账号上。
 */
function resolveAnonDeviceId(c: Parameters<MiddlewareHandler>[0]): string {
  const header = c.req.header('x-device-id');
  if (header) return header;

  const existing = getCookie(c, ANON_COOKIE);
  if (existing) return existing;

  const minted = `dev_${randomUUID()}`;
  setCookie(c, ANON_COOKIE, minted, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: ANON_COOKIE_MAX_AGE,
    // 生产（server 模式，站在 caddy HTTPS 后）才加 Secure；本地 http 调试不能加否则 cookie 不落。
    secure: getDeployMode() === 'server',
  });
  return minted;
}

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
      // 无有效 token：给每个匿名访客一条独立游客行（X-Device-Id 头 > yl_anon cookie > 新种）。
      // 绝不再回落到共享 ANON_PHONE —— 那是「多个访客串成同一账号 + 个人名字/画像互相污染」的根因。
      user = getOrCreateGuestByDevice(resolveAnonDeviceId(c));
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
