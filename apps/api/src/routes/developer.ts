import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { bodyLimit } from 'hono/body-limit';
import { ApiKeyApplicationSchema, ApiKeySmsSendSchema, ApiKeySmsVerifySchema } from '@yelan/shared';
import { requireAuth } from '../middleware/auth';
import { accountIdentity, gatewayDatabase } from '../gateway/service';
import { GatewayError, normalizeVerifiedPhone } from '../gateway/database';

export interface KeySmsProvider {
  send(userId: string, phone: string): Promise<{ challengeId: string }>;
  verify(userId: string, challengeId: string, code: string): Promise<{ phone: string }>;
}

// Production passes no provider. Simulation is injected only by a separate
// loopback rehearsal process; no request parameter can enable it.
export function createDeveloperRoute(
  options: { sms?: KeySmsProvider; simulation?: boolean; baseUrl?: string } = {},
) {
  const sms = options.sms;
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
    const user = accountIdentity(c.get('userId') as string);
    if (!user || user.isGuest || user.deletedAt)
      return c.json({ code: 'REGISTERED_ACCOUNT_REQUIRED', message: '请先登录注册账号' }, 403);
    c.header('Cache-Control', 'no-store');
    await next();
  });
  route.get('/', (c) =>
    c.json({
      baseUrl: options.baseUrl ?? 'https://yetland.cn/v1',
      smsEnabled: !!sms,
      applicationEnabled: !!sms,
      simulation: options.simulation ?? false,
      message: sms
        ? '填写名称并验证手机号后申请 Key。'
        : '短信验证暂未开放，请等待开通；已有 Key 可继续使用。',
      keys: gatewayDatabase().keys(c.get('userId') as string),
      quota: gatewayDatabase().quota(c.get('userId') as string),
    }),
  );
  route.get('/quota', (c) => c.json(gatewayDatabase().quota(c.get('userId') as string)));
  route.post('/keys', async (c) => {
    const input = ApiKeyApplicationSchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success)
      return c.json(
        { code: 'INVALID_REQUEST', message: '请填写 Key 名称、版本并完成手机号验证' },
        400,
      );
    if (!sms)
      return c.json(
        { code: 'SMS_UNAVAILABLE', message: '短信验证暂未开放，当前不能申请 Key' },
        503,
      );
    const issued = gatewayDatabase().createVerifiedKey(
      accountIdentity(c.get('userId') as string)!,
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
  route.post('/sms/verify', async (c) => {
    if (!sms) return c.json({ code: 'SMS_UNAVAILABLE', message: '短信服务暂未开放' }, 503);
    const input = ApiKeySmsVerifySchema.safeParse(await c.req.json().catch(() => null));
    if (!input.success) throw new GatewayError('INVALID_CODE', 400, '请输入六位验证码');
    const userId = c.get('userId') as string;
    const verified = await sms.verify(userId, input.data.challengeId, input.data.code);
    const id = randomUUID();
    const db = gatewayDatabase();
    db.db
      .prepare('INSERT INTO phone_verifications VALUES (?,?,?,?,?,NULL)')
      .run(id, userId, normalizeVerifiedPhone(verified.phone), 'api_key', new Date().toISOString());
    db.audit(options.simulation ? 'phone.verify.simulation' : 'phone.verify.sms', id);
    return c.json({ verificationId: id });
  });
  route.delete('/keys/:id', (c) => {
    const db = gatewayDatabase();
    const key = db.key(c.req.param('id'));
    if (!key || key.userId !== c.get('userId'))
      return c.json({ code: 'NOT_FOUND', message: 'Key 不存在' }, 404);
    if (key.status !== 'revoked') db.patchKey(key.id, { status: 'revoked' });
    return c.json({ ok: true });
  });
  return route;
}
export const developerRoute = createDeveloperRoute();
