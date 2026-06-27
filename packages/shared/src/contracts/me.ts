import { z } from 'zod';
import { EmailSchema, PasswordSchema } from './auth';
import { PreferenceCategorySchema } from '../schemas/sidecar';

export const MeNamePatchSchema = z.object({
  name: z.string().trim().min(1).max(24),
});

// 绑定邮箱（email-auth phase）：
// - 已有密码用户：只传 email，给当前账户挂上邮箱登录入口
// - 无密码用户（开门流匿名号 / OTP-only 老用户）：必须同时传 password，否则
//   挂上邮箱也没办法用邮箱登录，等于半成品状态。
export const MeEmailBindSchema = z.object({
  email: EmailSchema,
  password: PasswordSchema.optional(),
});

export type MeEmailBind = z.infer<typeof MeEmailBindSchema>;

// PATCH /api/me/profile — 账户档案字段，全部 optional
// 字符串：trim 后非空写入；显式传 null 视为清空；不传则不动
// （contract 层用 union [string, null]；route 层会转换 trim 与空字符串）
// 注意：email 这里用 EmailSchema（trim+lowercase）确保和 emailIndex 一致；
// 但 patch 路径**不应**用来变更登录邮箱（绕过唯一性检查）—— 后端 patch
// 会把 email 写到 user 行但不会触碰 emailIndex；要换登录标识必须走 bind。
export const MeProfilePatchSchema = z.object({
  email: z.union([EmailSchema, z.null()]).optional(),
  nickname: z.union([z.string().trim().min(1).max(48), z.null()]).optional(),
  avatarUrl: z.union([z.string().trim().url().max(500), z.null()]).optional(),
  bio: z.union([z.string().trim().max(280), z.null()]).optional(),
});

export type MeProfilePatch = z.infer<typeof MeProfilePatchSchema>;

// —— 手机号变更 / 注销 / 全部登出（Phase 4） ——

export const MePhoneChangeSchema = z.object({
  newPhone: z.string().regex(/^\+?\d{8,15}$/),
  code: z.string().regex(/^\d{4,8}$/),
});

// 注销：必须提供一项二次确认 — 当前密码（如有）或 OTP 验证码
export const MeAccountDeleteSchema = z.object({
  currentPassword: z.string().min(1).max(128).optional(),
  code: z.string().regex(/^\d{4,8}$/).optional(),
}).refine((v) => v.currentPassword || v.code, {
  message: '需要密码或验证码二次确认',
});

export type MePhoneChange = z.infer<typeof MePhoneChangeSchema>;
export type MeAccountDelete = z.infer<typeof MeAccountDeleteSchema>;

// ── Memories ──
export const MeMemoriesPreferenceSchema = z.object({
  id: z.string().optional(),
  clientId: z.number().optional(),
  characterId: z.string().min(1),
  mode: z.enum(['main', 'if']),
  text: z.string().min(1).max(2000),
  category: PreferenceCategorySchema.optional(),
  embedding: z.array(z.number()).min(1).max(4096).optional(),
  weight: z.number().optional(),
});

export const MeMemoriesEventSchema = z.object({
  id: z.string().optional(),
  clientId: z.number().optional(),
  characterId: z.string().min(1),
  mode: z.enum(['main', 'if']),
  date: z.string().min(1).max(32),
  text: z.string().min(1).max(2000),
  embedding: z.array(z.number()).min(1).max(4096).optional(),
  emotion: z.string().max(64).optional(),
});

export const MeMemoriesUpsertSchema = z.object({
  preferences: z.array(MeMemoriesPreferenceSchema).optional(),
  events: z.array(MeMemoriesEventSchema).optional(),
});

export const MeMemoriesRecallSchema = z.object({
  characterId: z.string().min(1),
  mode: z.enum(['main', 'if']),
  embedding: z.array(z.number()).min(1).max(4096),
  topK: z.number().int().min(1).max(20).optional(),
});

const MeMemoriesPreferenceResponseSchema = MeMemoriesPreferenceSchema.extend({
  id: z.string(),
  clientId: z.number().optional(),
  category: PreferenceCategorySchema,
  weight: z.number(),
  lastUsedAt: z.string(),
  updatedAt: z.string(),
  tombstone: z.boolean().optional(),
});

const MeMemoriesEventResponseSchema = MeMemoriesEventSchema.extend({
  id: z.string(),
  clientId: z.number().optional(),
  updatedAt: z.string(),
  tombstone: z.boolean().optional(),
});

const MeMemoryProfileFactSchema = z.object({
  id: z.string(),
  characterId: z.string(),
  scope: z.enum(['global', 'character', 'if']),
  type: z.enum(['preference', 'event', 'relationship']),
  text: z.string(),
  confidence: z.number().min(0).max(1),
  status: z.enum(['active', 'superseded', 'rejected']),
  source: z.enum(['sidecar', 'user', 'system']),
  sourceSessionId: z.string().optional(),
  updatedAt: z.string(),
});

const MeMemoryProfileSnapshotSchema = z.object({
  markdown: z.string(),
  updatedAt: z.string(),
});

export const MeMemoriesListResponseSchema = z.object({
  preferences: z.array(MeMemoriesPreferenceResponseSchema),
  events: z.array(MeMemoriesEventResponseSchema),
  profile: z.object({
    snapshot: MeMemoryProfileSnapshotSchema.nullable(),
    facts: z.array(MeMemoryProfileFactSchema),
  }),
});

export const MeMemoriesUpsertResponseSchema = z.object({
  preferences: z.array(MeMemoriesPreferenceResponseSchema),
  events: z.array(MeMemoriesEventResponseSchema),
});

export const MeMemoriesRecallResponseSchema = z.object({
  results: z.array(z.object({ id: z.string(), text: z.string(), score: z.number() })),
});

// ── Preferences ──
export const MePreferencesPutSchema = z.object({
  theme: z.enum(['dark', 'light']).optional(),
  fontScale: z.number().min(0.85).max(1.25).optional(),
  locale: z.string().min(2).max(16).optional(),
  stageLayoutOverrides: z.record(z.unknown()).optional(),
});

export const MePreferencesResponseSchema = z.object({
  userId: z.string(),
  theme: z.enum(['dark', 'light']),
  fontScale: z.number(),
  locale: z.string(),
  stageLayoutOverrides: z.record(z.unknown()),
  updatedAt: z.string(),
});

export type MeMemoriesUpsert = z.infer<typeof MeMemoriesUpsertSchema>;
export type MeMemoriesRecall = z.infer<typeof MeMemoriesRecallSchema>;
export type MeMemoriesListResponse = z.infer<typeof MeMemoriesListResponseSchema>;
export type MeMemoriesUpsertResponse = z.infer<typeof MeMemoriesUpsertResponseSchema>;
export type MeMemoriesRecallResponse = z.infer<typeof MeMemoriesRecallResponseSchema>;
export type MePreferencesPut = z.infer<typeof MePreferencesPutSchema>;
export type MePreferencesResponse = z.infer<typeof MePreferencesResponseSchema>;
export type MeNamePatch = z.infer<typeof MeNamePatchSchema>;
