import { z } from 'zod';
import type { Me } from '../types/user';

// 重导出 schemas/auth.ts 中的请求 schema（真理源）
export { OtpRequestSchema, OtpVerifySchema } from '../schemas/auth';
// 为兼容旧名也导出别名
export { OtpRequestSchema as AuthOtpRequestSchema, OtpVerifySchema as AuthOtpVerifySchema } from '../schemas/auth';

// ── Response schemas（新增）──
export const AuthOtpResponseSchema = z.object({ ok: z.literal(true) });

// Me 形状的复用块（避免 verify 和 me 两处漂移）
const MeShape = {
  id: z.string(),
  name: z.string().optional(),
  // phone optional —— email-only 注册用户没手机号
  phone: z.string().optional(),
  ageVerified: z.boolean(),
  narrativeBoundary: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  ifUnlocked: z.boolean(),
  createdAt: z.string(),
  // —— 账户档案扩展 ——
  email: z.string().email().optional(),
  nickname: z.string().min(1).max(48).optional(),
  avatarUrl: z.string().url().optional(),
  bio: z.string().max(280).optional(),
  // —— 安全状态指示位 ——
  hasPassword: z.boolean().optional(),
  passwordUpdatedAt: z.string().optional(),
  phoneVerifiedAt: z.string().optional(),
} as const;

const MeResponseSchemaInner = z.object(MeShape) satisfies z.ZodType<Me>;

export const AuthVerifyResponseSchema = z.object({
  token: z.string(),
  me: MeResponseSchemaInner,
});

export const AuthMeResponseSchema = MeResponseSchemaInner;

export type AuthOtpResponse = z.infer<typeof AuthOtpResponseSchema>;
export type AuthVerifyResponse = z.infer<typeof AuthVerifyResponseSchema>;
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

// —— 密码鉴权（feat/user-account, Phase 3）——
// 强度规则在服务端二次校验（services/password.ts isStrongPassword）；这里只做基础长度
export const PasswordSchema = z.string().min(8).max(128);

// 邮箱（feat/user-account, email-auth phase）：
// trim + toLowerCase 在 schema 层做掉，emailIndex 才能保证大小写不变形地命中。
// 同时给 me.ts 复用，避免 patch / bind / register 漂移。
export const EmailSchema = z.string().trim().toLowerCase().email().max(120);

export const AuthPasswordLoginSchema = z.object({
  phone: z.string().regex(/^\+?\d{8,15}$/),
  password: PasswordSchema,
});

// —— 邮箱 + 密码登录（email-auth phase）——
// 用户首选注册/登录路径；phone OTP 路径保留为 legacy。
// register 可选 name → 同时落 user.name（角色对你的称呼），少走一次 NameScene。
export const AuthEmailRegisterSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
  name: z.string().trim().min(1).max(24).optional(),
});

export const AuthEmailLoginSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema,
});

export const AuthPasswordResetSchema = z.object({
  phone: z.string().regex(/^\+?\d{8,15}$/),
  code: z.string().regex(/^\d{4,8}$/),
  newPassword: PasswordSchema,
});

// 自己改密码：需要 requireAuth；可选 currentPassword（首次设置时不传）
export const MePasswordSetSchema = z.object({
  currentPassword: z.string().min(1).max(128).optional(),
  newPassword: PasswordSchema,
});

export type AuthPasswordLogin = z.infer<typeof AuthPasswordLoginSchema>;
export type AuthPasswordReset = z.infer<typeof AuthPasswordResetSchema>;
export type MePasswordSet = z.infer<typeof MePasswordSetSchema>;
export type AuthEmailRegister = z.infer<typeof AuthEmailRegisterSchema>;
export type AuthEmailLogin = z.infer<typeof AuthEmailLoginSchema>;
