// 手机号 + OTP（mock：任何 4-8 位数字都接受）
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  AuthOtpRequestSchema,
  AuthOtpVerifySchema,
  AuthOtpResponseSchema,
  AuthVerifyResponseSchema,
  AuthMeResponseSchema,
  AuthPasswordLoginSchema,
  AuthPasswordResetSchema,
  AuthEmailRegisterSchema,
  AuthEmailLoginSchema,
} from '@yelan/shared';
import {
  getOrCreateUserByPhone,
  loginWithPassword,
  resetPasswordViaOtp,
  registerWithEmail,
  loginWithEmail,
  PasswordError,
  EmailAuthError,
  UserDeletedError,
} from '../services/users';
import { toMe } from './me';
import { requireAuth } from '../middleware/auth';
import { getUserById } from '../services/users';
import { validationHook } from '../middleware/validation';

export const mockAuthRoute = new Hono();

function passwordErrorToHttp(e: PasswordError): { status: 400 | 401 | 403 | 404 | 423; body: { code: string; message: string } } {
  switch (e.code) {
    case 'WEAK':
      return { status: 400, body: { code: 'PASSWORD_WEAK', message: e.message } };
    case 'WRONG':
      return { status: 401, body: { code: 'PASSWORD_WRONG', message: e.message } };
    case 'LOCKED':
      return { status: 423, body: { code: 'ACCOUNT_LOCKED', message: e.message } };
    case 'NO_PASSWORD':
      return { status: 400, body: { code: 'PASSWORD_NOT_SET', message: e.message } };
    case 'NOT_FOUND':
      return { status: 404, body: { code: 'NOT_FOUND', message: e.message } };
  }
}

mockAuthRoute.post(
  '/otp',
  zValidator('json', AuthOtpRequestSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    console.log(`[auth] OTP requested for ${body.phone}`);
    return c.json(AuthOtpResponseSchema.parse({ ok: true }));
  },
);

mockAuthRoute.post(
  '/verify',
  zValidator('json', AuthOtpVerifySchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    try {
      const guestDeviceId = c.req.header('x-device-id');
      const user = getOrCreateUserByPhone(body.phone, guestDeviceId);
      return c.json(AuthVerifyResponseSchema.parse({ token: user.token, me: toMe(user) }));
    } catch (e) {
      if (e instanceof UserDeletedError) {
        // 410 GONE：账号已注销，不能 OTP 复活
        return c.json({ code: 'ACCOUNT_DELETED', message: '该账号已注销' }, 410);
      }
      throw e;
    }
  },
);

// 改走 requireAuth 子路由 → 自动做 tokenVersion + deletedAt 拦截，
// 而不是手写检查（之前直接调 getUserByToken 会漏掉版本号检查）
const authMeSubRoute = new Hono();
authMeSubRoute.use('*', requireAuth());
authMeSubRoute.get('/', (c) => {
  const userId = c.get('userId') as string;
  const u = getUserById(userId);
  if (!u) return c.json({ code: 'NOT_FOUND', message: 'user not found' }, 404);
  return c.json(AuthMeResponseSchema.parse(toMe(u)));
});
mockAuthRoute.route('/me', authMeSubRoute);

// ── 密码登录（Phase 3） ─────────────────────────────────────
mockAuthRoute.post(
  '/password/login',
  zValidator('json', AuthPasswordLoginSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    try {
      const { user, token } = await loginWithPassword(body.phone, body.password);
      return c.json(AuthVerifyResponseSchema.parse({ token, me: toMe(user) }));
    } catch (e) {
      if (e instanceof PasswordError) {
        const { status, body: errBody } = passwordErrorToHttp(e);
        return c.json(errBody, status);
      }
      throw e;
    }
  },
);

mockAuthRoute.post(
  '/password/reset',
  zValidator('json', AuthPasswordResetSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    try {
      const { user, token } = await resetPasswordViaOtp(body.phone, body.code, body.newPassword);
      return c.json(AuthVerifyResponseSchema.parse({ token, me: toMe(user) }));
    } catch (e) {
      if (e instanceof PasswordError) {
        const { status, body: errBody } = passwordErrorToHttp(e);
        return c.json(errBody, status);
      }
      throw e;
    }
  },
);

// ── 邮箱 + 密码注册/登录（email-auth phase）─────────────────────
mockAuthRoute.post(
  '/email/register',
  zValidator('json', AuthEmailRegisterSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    try {
      const guestDeviceId = c.req.header('x-device-id');
      const { user, token } = await registerWithEmail(body.email, body.password, body.name, guestDeviceId);
      return c.json(AuthVerifyResponseSchema.parse({ token, me: toMe(user) }));
    } catch (e) {
      if (e instanceof EmailAuthError) {
        return c.json({ code: e.code, message: e.message }, 409);
      }
      if (e instanceof PasswordError) {
        const { status, body: errBody } = passwordErrorToHttp(e);
        return c.json(errBody, status);
      }
      throw e;
    }
  },
);

mockAuthRoute.post(
  '/email/login',
  zValidator('json', AuthEmailLoginSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    try {
      const { user, token } = await loginWithEmail(body.email, body.password);
      return c.json(AuthVerifyResponseSchema.parse({ token, me: toMe(user) }));
    } catch (e) {
      if (e instanceof PasswordError) {
        const { status, body: errBody } = passwordErrorToHttp(e);
        return c.json(errBody, status);
      }
      throw e;
    }
  },
);
