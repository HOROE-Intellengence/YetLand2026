import { BirdClient } from '@messagebird/sdk';
import type {
  Verification,
  VerificationCheckResult,
  VerifyVerificationsCreateParams,
  VerifyVerificationsCheckParams,
} from '@messagebird/sdk';
import { randomUUID } from 'node:crypto';
import { GatewayError, normalizeVerifiedEmail, type GatewayDatabase } from './database';

export interface KeyEmailProvider {
  send(userId: string, email: string): Promise<{ challengeId: string }>;
  verify(userId: string, challengeId: string, code: string): Promise<{ email: string }>;
}
export interface BirdVerifyClient {
  create(input: VerifyVerificationsCreateParams): PromiseLike<Verification>;
  check(input: VerifyVerificationsCheckParams): PromiseLike<VerificationCheckResult>;
}
type Challenge = {
  id: string;
  userId: string;
  email: string;
  providerId: string | null;
  createdAt: number;
  expiresAt: number;
  attempts: number;
  consumedAt: number | null;
  verifying: number;
};
export const birdEmailConfigured = () => {
  const key = process.env.BIRD_API_KEY?.trim();
  return !!key && key !== 'bk_xxxxxxxxx';
};
function providerError(error: unknown): GatewayError {
  // Provider errors may contain recipient data; expose only controlled messages.
  const status = (error as { statusCode?: number } | null)?.statusCode;
  if (status === 429)
    return new GatewayError('EMAIL_RATE_LIMITED', 429, '验证码发送或验证过于频繁，请稍后再试');
  if (status === 404) return new GatewayError('INVALID_CHALLENGE', 400, '验证码已失效，请重新发送');
  if (status === 400 || status === 422)
    return new GatewayError(
      'EMAIL_REJECTED',
      400,
      '邮件验证码请求未被接受，请检查邮箱地址或稍后重试',
    );
  return new GatewayError('EMAIL_UNAVAILABLE', 503, '邮件验证码服务暂时不可用，请稍后重试');
}
export function createBirdEmailProvider(
  db: () => GatewayDatabase,
  client: BirdVerifyClient,
): KeyEmailProvider {
  return {
    async send(userId, address) {
      const email = normalizeVerifiedEmail(address);
      const database = db();
      const time = Date.now();
      const challengeId = randomUUID();
      database.db
        .transaction(() => {
          if (
            database.db
              .prepare("SELECT 1 FROM api_keys WHERE verifiedEmail=? AND status!='revoked'")
              .get(email)
          )
            throw new GatewayError('EMAIL_KEY_LIMIT', 409, '该邮箱已有 Key，请先撤销旧 Key');
          const active = database.db
            .prepare(
              'SELECT 1 FROM email_challenges WHERE email=? AND userId!=? AND consumedAt IS NULL AND expiresAt>?',
            )
            .get(email, userId, time);
          if (active)
            throw new GatewayError('EMAIL_IN_PROGRESS', 429, '该邮箱正在验证中，请稍后重试');
          // Reserve before awaiting Bird: parallel requests and process restarts cannot bypass limits.
          for (const scope of [`user:${userId}`, `email:${email}`]) {
            const limit = database.db
              .prepare('SELECT * FROM email_send_limits WHERE scope=?')
              .get(scope) as { lastSentAt: number; windowStart: number; count: number } | undefined;
            if (limit && time - limit.lastSentAt < 60000)
              throw new GatewayError('EMAIL_RATE_LIMITED', 429, '请等待 60 秒后再发送验证码');
            const inWindow = limit && time - limit.windowStart < 3600000;
            if (inWindow && limit.count >= 5)
              throw new GatewayError(
                'EMAIL_RATE_LIMITED',
                429,
                '每小时最多发送 5 次验证码，请稍后再试',
              );
            database.db
              .prepare('INSERT OR REPLACE INTO email_send_limits VALUES (?,?,?,?)')
              .run(
                scope,
                time,
                inWindow ? limit.windowStart : time,
                inWindow ? limit.count + 1 : 1,
              );
          }
          database.db
            .prepare(
              'INSERT INTO email_challenges(id,userId,email,createdAt,expiresAt) VALUES (?,?,?,?,?)',
            )
            .run(challengeId, userId, email, time, time + 10 * 60000);
        })
        .immediate();
      try {
        const verification = await client.create({
          to: { email },
          options: { language: 'zh', code_length: 6 },
        });
        const expiresAt = Math.min(Date.parse(verification.expires_at), time + 10 * 60000);
        if (
          verification.status !== 'pending' ||
          !verification.id ||
          normalizeVerifiedEmail(verification.to.email ?? '') !== email ||
          !Number.isFinite(expiresAt) ||
          expiresAt <= Date.now()
        )
          throw new GatewayError('EMAIL_SEND_FAILED', 503, '邮件验证码发送失败，请稍后重试');
        database.db
          .transaction(() => {
            database.db
              .prepare(
                'UPDATE email_challenges SET consumedAt=? WHERE email=? AND id!=? AND consumedAt IS NULL',
              )
              .run(Date.now(), email, challengeId);
            database.db
              .prepare('UPDATE email_challenges SET providerId=?,expiresAt=? WHERE id=?')
              .run(verification.id, expiresAt, challengeId);
          })
          .immediate();
        return { challengeId };
      } catch (error) {
        database.db
          .prepare('UPDATE email_challenges SET consumedAt=? WHERE id=?')
          .run(Date.now(), challengeId);
        throw error instanceof GatewayError ? error : providerError(error);
      }
    },
    async verify(userId, challengeId, code) {
      if (!/^\d{6}$/.test(code)) throw new GatewayError('INVALID_CODE', 400, '请输入六位验证码');
      const database = db();
      const challenge = database.db
        .transaction(() => {
          const row = database.db
            .prepare('SELECT * FROM email_challenges WHERE id=?')
            .get(challengeId) as Challenge | undefined;
          if (
            !row ||
            row.userId !== userId ||
            !row.providerId ||
            row.consumedAt !== null ||
            row.expiresAt <= Date.now() ||
            row.attempts >= 5
          )
            throw new GatewayError('INVALID_CHALLENGE', 400, '验证码已失效，请重新发送');
          if (row.verifying)
            throw new GatewayError('VERIFICATION_IN_PROGRESS', 429, '验证码正在验证，请稍后');
          database.db
            .prepare('UPDATE email_challenges SET verifying=1,attempts=attempts+1 WHERE id=?')
            .run(challengeId);
          return row;
        })
        .immediate();
      try {
        const result = await client.check({ to: { email: challenge.email }, code });
        if (result.success !== true) {
          if (result.reason !== 'incorrect_code')
            database.db
              .prepare('UPDATE email_challenges SET consumedAt=? WHERE id=?')
              .run(Date.now(), challengeId);
          throw new GatewayError(
            'INVALID_CODE',
            400,
            result.reason === 'incorrect_code'
              ? '验证码不正确，请重新输入'
              : '验证码已失效，请重新发送',
          );
        }
        if (
          result.verification.id !== challenge.providerId ||
          result.verification.status !== 'verified' ||
          normalizeVerifiedEmail(result.verification.to.email ?? '') !== challenge.email
        )
          throw new GatewayError('INVALID_CHALLENGE', 400, '验证码核验不匹配，请重新发送');
        const consumed = database.db
          .prepare(
            'UPDATE email_challenges SET consumedAt=? WHERE id=? AND consumedAt IS NULL AND verifying=1 AND expiresAt>?',
          )
          .run(Date.now(), challengeId, Date.now());
        if (!consumed.changes)
          throw new GatewayError('INVALID_CHALLENGE', 400, '验证码已失效，请重新发送');
        return { email: challenge.email };
      } catch (error) {
        throw error instanceof GatewayError ? error : providerError(error);
      } finally {
        database.db.prepare('UPDATE email_challenges SET verifying=0 WHERE id=?').run(challengeId);
      }
    },
  };
}
export function configuredBirdEmailProvider(
  db: () => GatewayDatabase,
): KeyEmailProvider | undefined {
  if (!birdEmailConfigured()) return undefined;
  const bird = new BirdClient({
    apiKey: process.env.BIRD_API_KEY!.trim(),
    timeout: 20000,
    maxRetries: 0,
  });
  return createBirdEmailProvider(db, bird.verify.verifications);
}
