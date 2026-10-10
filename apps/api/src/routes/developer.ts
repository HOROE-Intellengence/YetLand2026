import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { bodyLimit } from 'hono/body-limit';
import {
  ApiKeyApplicationSchema,
  ApiKeySmsSendSchema,
  ApiKeySmsVerifySchema,
  ApiKeyEmailSendSchema,
  API_PUBLIC_BASE_URL,
} from '@yelan/shared';
import { requireAuth } from '../middleware/auth';
import { accountIdentity, gatewayDatabase } from '../gateway/service';
import {
  GatewayError,
  normalizeVerifiedPhone,
  normalizeVerifiedEmail,
  type GatewayDatabase,
  type Identity,
} from '../gateway/database';
import { configuredBirdEmailProvider, type KeyEmailProvider } from '../gateway/email-verification';

export interface KeySmsProvider {
  send(userId: string, phone: string): Promise<{ challengeId: string }>;
  verify(userId: string, challengeId: string, code: string): Promise<{ phone: string }>;
}

// Simulation is injected only by a separate loopback rehearsal process.
export function createDeveloperRoute(
  options: {
    sms?: KeySmsProvider;
    email?: KeyEmailProvider | (() => KeyEmailProvider | undefined);
    simulation?: boolean;
    baseUrl?: string;
    db?: () => GatewayDatabase;
    user?: (id: string) => Identity | undefined;
  } = {},
) {
  const sms = options.sms;
  const getEmail = () => (typeof options.email === 'function' ? options.email() : options.email);
  const database = options.db ?? gatewayDatabase;
  const identity = options.user ?? accountIdentity;
  const route = new Hono();
  route.use('*', bodyLimit({ maxSize: 16 * 1024 }));
  route.onError((e, c) => {
    const error =
      e instanceof GatewayError
        ? e
        : new GatewayError('APPLICATION_FAILED', 500, '申请失败，请稍后重试');
    return c.json({ code: error.code, message: error.message }, error.status);
  });
  route.use('*', requireAuth());
  route.use('*', async (c, next) => {
    const user = identity(c.get('userId') as string);
    if (!user || user.isGuest || user.deletedAt)
      return c.json({ code: 'REGISTERED_ACCOUNT_REQUIRED', message: '请先登录注册账号' }, 403);
    c.header('Cache-Control', 'no-store');
    await next();
  });
  route.get('/', (c) => {
    const email = getEmail();
    return c.json({
      baseUrl: options.baseUrl ?? API_PUBLIC_BASE_URL,
      smsEnabled: !!sms,
      emailEnabled: !!email,
      applicationEnabled: !!sms || !!email,
      simulation: options.simulation ?? false,
      message:
        sms || email
          ? '填写名称并验证手机号或邮箱后申请 Key。'
          : '验证码服务暂未开放；已有 Key 可继续使用。',
      keys: database().keys(c.get('userId') as string),
      quota: database().quota(c.get('userId') as string),
    });
  });
  route.get('/quota', (c) => c.json(database().quota(c.get('userId') as string)));
  route.post('/keys', async (c) => {
    const input = ApiKeyApplicationSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(
        { code: 'INVALID_REQUEST', message: '请填写 Key 名称、版本并完成手机号或邮箱验证' },
        400,
      );
    if (!sms && !getEmail())
      return c.json(
        { code: 'SMS_UNAVAILABLE', message: '验证码服务暂未开放，当前不能申请 Key' },
        503,
      );
    const issued = database().createVerifiedKey(
      identity(c.get('userId') as string)!,
      {
        name: input.data.name,
        tier: input.data.tier,
        dailyLimit: 100,
        rpm: 20,
        concurrency: 2,
      },
      input.data.verificationId,
    );
    return c.json(issued, 201);
  });
  route.post('/sms/send', async (c) => {
    if (!sms) return c.json({ code: 'SMS_UNAVAILABLE', message: '短信服务暂未开放' }, 503);
    const input = ApiKeySmsSendSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new GatewayError('INVALID_PHONE', 400, '请填写手机号');
    return c.json(
      await sms.send(c.get('userId') as string, normalizeVerifiedPhone(input.data.phone)),
    );
  });
  route.post('/email/send', async (c) => {
    const email = getEmail();
    if (!email)
      return c.json({ code: 'EMAIL_UNAVAILABLE', message: '邮件验证码服务暂未开放' }, 503);
    const input = ApiKeyEmailSendSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new GatewayError('INVALID_EMAIL', 400, '请输入有效的邮箱地址');
    return c.json(await email.send(c.get('userId') as string, input.data.email));
  });
  route.post('/email/verify', async (c) => {
    const email = getEmail();
    if (!email)
      return c.json({ code: 'EMAIL_UNAVAILABLE', message: '邮件验证码服务暂未开放' }, 503);
    const input = ApiKeySmsVerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new GatewayError('INVALID_CODE', 400, '请输入六位验证码');
    const userId = c.get('userId') as string;
    const verified = await email.verify(userId, input.data.challengeId, input.data.code);
    const id = randomUUID();
    const db = database();
    db.db
      .prepare('INSERT INTO email_verifications VALUES (?,?,?,?,?,NULL)')
      .run(id, userId, normalizeVerifiedEmail(verified.email), 'api_key', new Date().toISOString());
    db.audit('email.verify.bird', id);
    return c.json({ verificationId: id });
  });
  route.post('/sms/verify', async (c) => {
    if (!sms) return c.json({ code: 'SMS_UNAVAILABLE', message: '短信服务暂未开放' }, 503);
    const input = ApiKeySmsVerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new GatewayError('INVALID_CODE', 400, '请输入六位验证码');
    const userId = c.get('userId') as string;
    const verified = await sms.verify(userId, input.data.challengeId, input.data.code);
    const id = randomUUID();
    const db = database();
    db.db
      .prepare('INSERT INTO phone_verifications VALUES (?,?,?,?,?,NULL)')
      .run(id, userId, normalizeVerifiedPhone(verified.phone), 'api_key', new Date().toISOString());
    db.audit(options.simulation ? 'phone.verify.simulation' : 'phone.verify.sms', id);
    return c.json({ verificationId: id });
  });
  route.delete('/keys/:id', (c) => {
    const db = database();
    const key = db.key(c.req.param('id'));
    if (!key || key.userId !== c.get('userId'))
      return c.json({ code: 'NOT_FOUND', message: 'Key 不存在' }, 404);
    if (key.status !== 'revoked') db.patchKey(key.id, { status: 'revoked' });
    return c.json({ ok: true });
  });
  return route;
}
export const developerRoute = createDeveloperRoute({
  email: () => configuredBirdEmailProvider(gatewayDatabase),
});
