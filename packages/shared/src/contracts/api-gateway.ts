import { z } from 'zod';

export const ApiTierSchema = z.enum(['pure', 'advanced']);
export type ApiTier = z.infer<typeof ApiTierSchema>;
export const ApiKeyNameSchema = z.string().trim().min(1, '请填写 Key 名称').max(80);
export const ApiKeySmsSendSchema = z.object({ phone: z.string().trim().min(1).max(30) }).strict();
export const ApiKeySmsVerifySchema = z
  .object({
    challengeId: z.string().min(1).max(100),
    code: z.string().regex(/^\d{6}$/),
  })
  .strict();
export const ApiKeyApplicationSchema = z
  .object({
    name: ApiKeyNameSchema,
    tier: ApiTierSchema,
    verificationId: z.string().min(1).max(100),
  })
  .strict();
export const ApiKeyCreateSchema = z
  .object({
    userId: z.string().min(1).max(100),
    name: ApiKeyNameSchema,
    tier: ApiTierSchema,
    dailyLimit: z.number().int().min(1).max(100000).default(100),
    rpm: z.number().int().min(1).max(1000).default(20),
    concurrency: z.number().int().min(1).max(50).default(2),
    expiresAt: z.string().datetime().optional(),
  })
  .strict();
export const ApiKeyPatchSchema = z
  .object({
    name: ApiKeyNameSchema.optional(),
    status: z.enum(['active', 'disabled', 'revoked']).optional(),
    dailyLimit: z.number().int().min(1).max(100000).optional(),
    rpm: z.number().int().min(1).max(1000).optional(),
    concurrency: z.number().int().min(1).max(50).optional(),
  })
  .strict();
export const ApiGatewaySettingsSchema = z
  .object({
    enabled: z.boolean(),
    upstreamId: z.string().min(1).max(100),
    accountDailyLimit: z.number().int().min(1).max(1000000),
    accountRpm: z.number().int().min(1).max(5000),
    accountConcurrency: z.number().int().min(1).max(100),
    timeoutSeconds: z.number().int().min(10).max(600),
  })
  .strict();
export const ApiPreludeDraftSchema = z
  .object({
    content: z.string().trim().min(1).max(50000),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const ApiPreludePublishSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export const ApiPreludeRollbackSchema = z
  .object({ versionId: z.number().int().positive(), revision: z.number().int().nonnegative() })
  .strict();
export const ApiCompletionSchema = z
  .object({
    model: z.string().min(1).max(200),
    messages: z
      .array(
        z
          .object({
            role: z.enum(['system', 'developer', 'user', 'assistant', 'tool', 'function']),
            content: z.unknown().optional(),
          })
          .passthrough(),
      )
      .min(1)
      .max(1000),
    stream: z.boolean().optional(),
  })
  .passthrough();
export type ApiCompletion = z.infer<typeof ApiCompletionSchema>;
export type ApiGatewaySettings = z.infer<typeof ApiGatewaySettingsSchema>;
export interface ApiQuota {
  unit: 'requests';
  period: 'day';
  timezone: 'UTC';
  total: number;
  used: number;
  remaining: number;
  resetsAt: string;
}
export interface ApiKeyView {
  id: string;
  userId: string;
  name: string;
  prefix: string;
  tier: ApiTier;
  status: 'active' | 'disabled' | 'revoked';
  verification: 'admin_test' | 'sms';
  verifiedPhone: string | null;
  createdAt: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  dailyLimit: number;
  rpm: number;
  concurrency: number;
  todayCalls: number;
  totalCalls: number;
}
export interface ApiCallView {
  id: string;
  userId: string;
  keyId: string;
  keyPrefix: string;
  tier: ApiTier;
  model: string;
  promptVersion: number | null;
  status: string;
  createdAt: string;
  durationMs: number | null;
  httpStatus: number | null;
  errorCode: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface ApiChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}
export interface ApiChatPage {
  messages: ApiChatMessage[];
  nextCursor: string | null;
}
export interface ApiPreludeView {
  draft: string;
  revision: number;
  publishedId: number | null;
  versions: { id: number; content: string; hash: string; createdAt: string; source: string }[];
}
export interface ApiOverview {
  total: number;
  succeeded: number;
  failed: number;
  active: number;
  averageMs: number | null;
  inputTokens: number;
  outputTokens: number;
  usageMissing: number;
  days: { day: string; total: number; succeeded: number }[];
  errors: { errorCode: string; count: number }[];
}
