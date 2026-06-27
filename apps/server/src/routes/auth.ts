// 手机号 + 验证码登录 + 密码登录（Phase 3）。
// 当前阶段：所有路由是 stub —— 生产路径未实现，但 schema 已对齐 mock，
// 避免 mock-fallback 失效时上线裸奔。Phase 3+ 真正实现见 services/auth.ts TODO。
import { Hono } from 'hono';
import {
  AuthOtpRequestSchema,
  AuthOtpResponseSchema,
  AuthOtpVerifySchema,
  AuthPasswordLoginSchema,
  AuthPasswordResetSchema,
  AuthEmailRegisterSchema,
  AuthEmailLoginSchema,
} from '@yelan/shared';
import type { Env } from '../types/bindings';

export const authRoute = new Hono<{ Bindings: Env }>();

// 一处统一的 NotImplemented 应答，保留响应中 phase 与 path 信息便于排查
function notImplemented(c: any, op: string) {
  return c.json(
    {
      code: 'NOT_IMPLEMENTED',
      message: `${op} is not yet implemented on apps/server; route mock-fallback to apps/api.`,
      phase: 'feat/user-account',
    },
    501,
  );
}

authRoute.post('/otp', async (c) => {
  const body = AuthOtpRequestSchema.parse(await c.req.json());
  void body;
  // TODO: services/auth/phone-otp.ts — 短信网关 + Redis TTL
  return c.json(AuthOtpResponseSchema.parse({ ok: true }));
});

authRoute.post('/verify', async (c) => {
  const body = AuthOtpVerifySchema.parse(await c.req.json());
  void body;
  // TODO: verify code → upsert user → register_grant → 发 token
  // CRITICAL: 实现时必须先检查 user.deletedAt → 返回 410 ACCOUNT_DELETED。
  // 不能让 OTP 把软删账号复活。参见 apps/api/src/routes/auth.ts:51 与
  // apps/api/src/__tests__/p1-regressions.test.ts（codex 抓到的 P1）。
  return notImplemented(c, 'POST /api/auth/verify');
});

authRoute.get('/me', async (c) => {
  // TODO: requireAuth → 返回 Me（与 mock /api/auth/me 形状一致）
  return notImplemented(c, 'GET /api/auth/me');
});

// ── 密码鉴权（Phase 3） ─────────────────────────────────────
authRoute.post('/password/login', async (c) => {
  const body = AuthPasswordLoginSchema.parse(await c.req.json());
  void body;
  // TODO: bcrypt/scrypt verify + lockout + 发新 token
  return notImplemented(c, 'POST /api/auth/password/login');
});

authRoute.post('/password/reset', async (c) => {
  const body = AuthPasswordResetSchema.parse(await c.req.json());
  void body;
  // TODO: OTP verify + hashPassword + bump tokenVersion
  return notImplemented(c, 'POST /api/auth/password/reset');
});

// ── 邮箱 + 密码（email-auth phase）─────────────────────────────
authRoute.post('/email/register', async (c) => {
  const body = AuthEmailRegisterSchema.parse(await c.req.json());
  void body;
  // TODO: emailIndex 唯一性检查 + scrypt hash + 写 token v1
  // CRITICAL: 邮箱必须 normalize（trim+toLowerCase）后再写 emailIndex，
  // 否则 'Foo@x.com' / 'foo@x.com' 会创建两个账户。
  return notImplemented(c, 'POST /api/auth/email/register');
});

authRoute.post('/email/login', async (c) => {
  const body = AuthEmailLoginSchema.parse(await c.req.json());
  void body;
  // TODO: emailIndex 查 → scrypt verify → lockout + 发新 token
  // CRITICAL: 与 password/login 一致，先检查 deletedAt → 410 ACCOUNT_DELETED；
  // 失败 5 次锁 15 分钟（与 services/users.ts MAX_FAILED_LOGINS 对齐）。
  return notImplemented(c, 'POST /api/auth/email/login');
});
