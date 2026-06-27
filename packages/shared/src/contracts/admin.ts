import { z } from 'zod';
import { ConstellationPointSchema, ConstellationEdgeSchema, ConstellationSchema } from './characters';
import { SidecarPromptKeySchema } from '../schemas/sidecar';

const Boundary = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]);
const Rarity = z.enum(['free', 'paid', 'hidden']);
const SubscriptionPlanId = z.enum(['moonlight', 'milkyway', 'eternal']);
const SubscriptionCycle = z.enum(['week', 'month']);
export const CharacterProfileSectionSchema = z.object({
  key: z.string().min(1).max(40),
  value: z.string().min(1).max(2000),
  order: z.number().int().min(0).max(1000),
});

// ── Characters ──
export const AdminCharactersCreateSchema = z.object({
  id: z.string().min(1).optional(),
  slug: z.string().min(2).max(40).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(40),
  rarity: Rarity,
  priceCandle: z.number().int().min(0),
  styleTags: z.array(z.string()).optional(),
  preludeCardId: z.string().min(1).nullable().optional(),
  boundaryDefault: Boundary,
  openingFirstVisit: z.string().max(200).optional(),
  openingReturnVisit: z.string().max(200).optional(),
  forbiddenPhrases: z.array(z.string()).optional(),
  description: z.string().max(2000).optional(),
  profileSections: z.array(CharacterProfileSectionSchema).optional(),
  isActive: z.boolean().optional(),
  reason: z.string().min(1),
});

export const AdminCharactersPatchSchema = AdminCharactersCreateSchema.partial().extend({
  reason: z.string().min(1),
});

export const AdminCharacterImportModeSchema = z.enum(['create', 'update', 'upsert']);

const CharacterImportProfileSectionInputSchema = z.object({
  key: z.string(),
  value: z.string(),
  order: z.number().int().optional(),
}).passthrough();

const CharacterImportCardSchema = z.object({
  id: z.string().min(1).optional(),
  slug: z.string(),
  name: z.string(),
  rarity: Rarity.optional(),
  priceCandle: z.coerce.number().int().min(0).optional(),
  price_candle: z.coerce.number().int().min(0).optional(),
  styleTags: z.array(z.string()).optional(),
  style_tags: z.array(z.string()).optional(),
  preludeCardId: z.string().min(1).nullable().optional(),
  prelude_card_id: z.string().min(1).nullable().optional(),
  boundaryDefault: Boundary.optional(),
  boundary_default: Boundary.optional(),
  isActive: z.boolean().optional(),
  is_active: z.boolean().optional(),
  openingFirstVisit: z.string().optional(),
  opening_first_visit: z.string().optional(),
  openingReturnVisit: z.string().optional(),
  opening_return_visit: z.string().optional(),
  forbiddenPhrases: z.array(z.string()).optional(),
  forbidden_phrases: z.array(z.string()).optional(),
  description: z.string().optional(),
  profileSections: z.array(CharacterImportProfileSectionInputSchema).optional(),
  profile_sections: z.array(CharacterImportProfileSectionInputSchema).optional(),
}).passthrough();

const CharacterImportOperatorFieldsSchema = z.object({
  rarity: Rarity.optional(),
  priceCandle: z.coerce.number().int().min(0).optional(),
  price_candle: z.coerce.number().int().min(0).optional(),
}).passthrough();

const CharacterImportTier2Schema = z.object({
  userRole: z.unknown().optional(),
  user_role: z.unknown().optional(),
  relationship: z.string().optional(),
  memo: z.array(z.unknown()).optional(),
}).passthrough();

export const AdminCharacterImportBundleSchema = z.object({
  card: CharacterImportCardSchema,
  operatorFields: CharacterImportOperatorFieldsSchema.optional(),
  operator_fields: CharacterImportOperatorFieldsSchema.optional(),
  tier2: CharacterImportTier2Schema.optional(),
}).passthrough();

export const AdminCharacterImportPreviewRequestSchema = z.object({
  raw: z.string().min(1),
  mode: AdminCharacterImportModeSchema.optional().default('upsert'),
});

export const AdminCharacterImportCommitSchema = AdminCharacterImportPreviewRequestSchema.extend({
  reason: z.string().min(1).max(500),
});

export const AdminCharacterImportPayloadSchema = AdminCharactersCreateSchema.omit({ reason: true });

export const AdminCharacterImportIssueSchema = z.object({
  severity: z.enum(['warning', 'error']),
  code: z.string(),
  path: z.string(),
  message: z.string(),
});

export const AdminCharacterImportTier2SummarySchema = z.object({
  detected: z.boolean(),
  supported: z.literal(false),
  userRoleName: z.string().optional(),
  memoCount: z.number().int().min(0).optional(),
  relationshipPreview: z.string().optional(),
});

export const AdminCharacterImportPreviewResponseSchema = z.object({
  mode: AdminCharacterImportModeSchema,
  canImport: z.boolean(),
  action: z.enum(['create', 'update', 'none']),
  existing: z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
  }).nullable(),
  character: AdminCharacterImportPayloadSchema.nullable(),
  warnings: z.array(AdminCharacterImportIssueSchema),
  errors: z.array(AdminCharacterImportIssueSchema),
  tier2: AdminCharacterImportTier2SummarySchema,
});

export const AdminCharactersListResponseSchema = z.object({
  characters: z.array(z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    rarity: Rarity,
    priceCandle: z.number(),
    styleTags: z.array(z.string()),
    promptCardKey: z.string().optional(),
    preludeCardId: z.string().nullable().optional(),
    boundaryDefault: Boundary,
    isActive: z.boolean(),
    openingLines: z.object({ firstVisit: z.string(), returnVisit: z.string() }),
    description: z.string().optional(),
    forbiddenPhrases: z.array(z.string()).optional(),
    profileSections: z.array(CharacterProfileSectionSchema),
    updatedAt: z.string().optional(),
  })),
});

export const AdminCharacterImportCommitResponseSchema = AdminCharacterImportPreviewResponseSchema.extend({
  imported: AdminCharactersListResponseSchema.shape.characters.element,
});

type CharacterImportIssueInput = z.infer<typeof AdminCharacterImportIssueSchema>;
type CharacterImportBundle = z.infer<typeof AdminCharacterImportBundleSchema>;

function issue(
  severity: 'warning' | 'error',
  code: string,
  path: string,
  message: string,
): CharacterImportIssueInput {
  return { severity, code, path, message };
}

function cleanString(value: string | undefined): string {
  return (value ?? '').trim();
}

function normalizeStringList(value: string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of value ?? []) {
    const item = raw.trim();
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
}

function normalizeProfileSections(
  value: z.infer<typeof CharacterImportProfileSectionInputSchema>[] | undefined,
  warnings: CharacterImportIssueInput[],
): z.infer<typeof CharacterProfileSectionSchema>[] {
  const out: z.infer<typeof CharacterProfileSectionSchema>[] = [];
  (value ?? []).forEach((section, index) => {
    const key = section.key.trim();
    const sectionValue = section.value.trim();
    if (!key || !sectionValue) {
      warnings.push(issue('warning', 'DROPPED_EMPTY_SECTION', `card.profileSections[${index}]`, '空的设定项目已忽略'));
      return;
    }
    out.push({ key, value: sectionValue, order: Number.isInteger(section.order) ? section.order! : index });
  });
  return out
    .sort((a, b) => a.order - b.order)
    .map((section, order) => ({ ...section, order }));
}

function summarizeTier2(tier2: CharacterImportBundle['tier2']): z.infer<typeof AdminCharacterImportTier2SummarySchema> {
  if (!tier2) return { detected: false, supported: false };
  const role = (tier2.userRole ?? tier2.user_role) as { name?: unknown } | undefined;
  const relationship = typeof tier2.relationship === 'string' ? tier2.relationship.trim() : '';
  return {
    detected: true,
    supported: false,
    userRoleName: typeof role?.name === 'string' ? role.name.trim() : undefined,
    memoCount: Array.isArray(tier2.memo) ? tier2.memo.length : 0,
    relationshipPreview: relationship ? relationship.slice(0, 80) : undefined,
  };
}

export function normalizeCharacterImportBundle(input: unknown): {
  character: z.infer<typeof AdminCharacterImportPayloadSchema> | null;
  warnings: CharacterImportIssueInput[];
  errors: CharacterImportIssueInput[];
  tier2: z.infer<typeof AdminCharacterImportTier2SummarySchema>;
} {
  const parsed = AdminCharacterImportBundleSchema.safeParse(input);
  if (!parsed.success) {
    return {
      character: null,
      warnings: [],
      errors: parsed.error.issues.map((zodIssue) =>
        issue('error', 'INVALID_IMPORT_BUNDLE', zodIssue.path.join('.') || 'root', zodIssue.message),
      ),
      tier2: { detected: false, supported: false },
    };
  }

  const { card } = parsed.data;
  const operatorFields = parsed.data.operatorFields ?? parsed.data.operator_fields;
  const warnings: CharacterImportIssueInput[] = [];
  const tier2 = summarizeTier2(parsed.data.tier2);
  if (tier2.detected) {
    warnings.push(issue('warning', 'TIER2_UNSUPPORTED', 'tier2', '已识别档②数据，但当前导入只写主角色卡；tier2 暂不入库'));
  }

  const payloadCandidate = {
    id: card.id,
    slug: cleanString(card.slug),
    name: cleanString(card.name),
    rarity: operatorFields?.rarity ?? card.rarity ?? 'free',
    priceCandle: operatorFields?.priceCandle ?? operatorFields?.price_candle ?? card.priceCandle ?? card.price_candle ?? 0,
    styleTags: normalizeStringList(card.styleTags ?? card.style_tags),
    preludeCardId: card.preludeCardId ?? card.prelude_card_id ?? null,
    boundaryDefault: card.boundaryDefault ?? card.boundary_default ?? 2,
    openingFirstVisit: cleanString(card.openingFirstVisit ?? card.opening_first_visit),
    openingReturnVisit: cleanString(card.openingReturnVisit ?? card.opening_return_visit),
    forbiddenPhrases: normalizeStringList(card.forbiddenPhrases ?? card.forbidden_phrases),
    description: cleanString(card.description),
    profileSections: normalizeProfileSections(card.profileSections ?? card.profile_sections, warnings),
    isActive: card.isActive ?? card.is_active,
  };

  const normalized = AdminCharacterImportPayloadSchema.safeParse(payloadCandidate);
  if (!normalized.success) {
    return {
      character: null,
      warnings,
      errors: normalized.error.issues.map((zodIssue) =>
        issue('error', 'INVALID_CHARACTER_PAYLOAD', zodIssue.path.join('.') || 'character', zodIssue.message),
      ),
      tier2,
    };
  }

  return { character: normalized.data, warnings, errors: [], tier2 };
}

// ── Policy ──
export const AdminPolicyPatchSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  reason: z.string().min(1).max(500),
});

// ── Candle ──
export const AdminCandleGrantSchema = z.object({
  userId: z.string(),
  delta: z.number().int(),
  reason: z.string().min(1),
  refId: z.string().optional(),
});

// ── Quota ──
export const AdminQuotaGrantSchema = z.object({
  userId: z.string(),
  bonusDelta: z.number().int(),
  reason: z.string().min(1),
});

export const AdminQuotaFreeLimitSchema = z.object({
  freeLimit: z.number().int().min(0).max(500),
  reason: z.string().min(1),
});

const QuotaDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional();

export const AdminQuotaSetUserSchema = z.object({
  userId: z.string().min(1),
  date: QuotaDateSchema,
  freeLimit: z.number().int().min(0).max(500).nullable().optional(),
  freeUsed: z.number().int().min(0).max(500).optional(),
  bonusLimit: z.number().int().min(0).max(500).optional(),
  bonusUsed: z.number().int().min(0).max(500).optional(),
  reason: z.string().min(1),
}).refine(
  (v) => v.freeLimit !== undefined || v.freeUsed !== undefined || v.bonusLimit !== undefined || v.bonusUsed !== undefined,
  { message: 'at least one quota field is required' },
);

export const AdminQuotaResetUserSchema = z.object({
  userId: z.string().min(1),
  date: QuotaDateSchema,
  reason: z.string().min(1),
});

export const AdminQuotaExchangeToggleSchema = z.object({
  userId: z.string(),
  enabled: z.boolean(),
  reason: z.string().min(1),
});

// ── Users ──
export const AdminUsersFlagsSchema = z.object({
  ifUnlocked: z.boolean().optional(),
  narrativeBoundary: Boundary.optional(),
  ageVerified: z.boolean().optional(),
  reason: z.string().min(1),
});

// ── If-Codes ──
export const AdminIfCodesCreateSchema = z.object({
  code: z.string().min(2).max(40),
  boundary: Boundary,
  // 可选：命中暗号当轮的瞬时升温目标温度（仅作用当轮，不留地板）。
  temperature: Boundary.optional(),
  source: z.string().min(1),
  reason: z.string().min(1),
});

export const AdminIfCodesToggleSchema = z.object({
  active: z.boolean(),
  reason: z.string().min(1),
});

// ── Config ──
export const AdminConfigEnvPatchSchema = z.object({
  patch: z.record(z.string(), z.string()),
  reason: z.string().min(1),
});

export const AdminConfigRuntimePatchSchema = z.object({
  narrativeBoundaryGlobal: Boundary.optional(),
  mockLatencyMs: z.number().int().min(0).max(5000).optional(),
  freeLimitOverride: z.number().int().min(0).max(500).nullable().optional(),
  reason: z.string().min(1),
});

export const AdminConfigTestLLMSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'deepseek']),
});

// ── LLM API 库存 ──
export const AdminLlmApiSchema = z.object({
  id: z.string().min(1).max(80).optional(),
  name: z.string().min(1).max(80),
  protocol: z.enum(['openai-compatible', 'anthropic', 'nvidia']),
  baseUrl: z.string().max(300).optional(),
  model: z.string().min(1).max(120),
  apiKey: z.string().optional().default(''),
  enabled: z.boolean().optional(),
  reason: z.string().min(1),
});

export const AdminLlmApiTestSchema = AdminLlmApiSchema.omit({ reason: true });

export const AdminLlmApiSelectSchema = z.object({
  role: z.enum(['main', 'sidecar']),
  id: z.string().nullable(),
  reason: z.string().min(1),
});

export const AdminLlmApiSelectTaskSchema = z.object({
  taskKey: z.enum(['outputStructurer', 'preferenceRecorder', 'quotaEnding', 'contextCompressor']),
  id: z.string().nullable(),
  reason: z.string().min(1),
});

export const AdminLlmReasoningEffortSchema = z.object({
  scenario: z.enum(['normal', 'cipher']),
  effort: z.enum(['minimal', 'low', 'medium', 'high']),
  reason: z.string().min(1),
});

// ── Prompt 灰度 ──
export const AdminPromptReleaseSchema = z.object({
  key: z.string().min(1),
  value: z.string().min(1),
  reason: z.string().min(1),
});

export const AdminPromptRollbackSchema = z.object({
  key: z.string().min(1),
  versionId: z.string().min(1),
  reason: z.string().min(1),
});

// ── 侧袋运行配置 ──
export const AdminSidecarConfigPatchSchema = z.object({
  enabled: z.record(SidecarPromptKeySchema, z.boolean()).optional(),
  order: z.array(SidecarPromptKeySchema).optional(),
  reason: z.string().min(1),
});

// ── Membership / 会员 ──
export const AdminMembershipCyclePatchSchema = z.object({
  price: z.number().min(0).max(100000).optional(),
  listPrice: z.number().min(0).max(100000).nullable().optional(),
  discountLabel: z.string().max(40).optional(),
  candleGrant: z.number().int().min(0).max(1000000).optional(),
  enabled: z.boolean().optional(),
});

export const AdminMembershipPlanPatchSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  tagline: z.string().max(120).optional(),
  description: z.string().max(500).optional(),
  perks: z.array(z.string().min(1).max(80)).max(12).optional(),
  active: z.boolean().optional(),
  featured: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
  cycleDetails: z.object({
    week: AdminMembershipCyclePatchSchema.optional(),
    month: AdminMembershipCyclePatchSchema.optional(),
  }).optional(),
  reason: z.string().min(1).max(500),
});

export const AdminMembershipGrantSchema = z.object({
  userId: z.string().min(1),
  planId: SubscriptionPlanId,
  cycle: SubscriptionCycle,
  periodDays: z.number().int().min(1).max(366).optional(),
  candleGrantOverride: z.number().int().min(0).max(1000000).optional(),
  reason: z.string().min(1).max(500),
});

export const AdminMembershipCancelSchema = z.object({
  userId: z.string().min(1),
  immediate: z.boolean().optional(),
  reason: z.string().min(1).max(500),
});

// ── Prelude / 前置提示卡 ──
export const PreludeCardScopeSchema = z.enum(['global', 'character', 'if']);

export const AdminPreludeCardCreateSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/).optional(),
  name: z.string().min(1).max(80),
  content: z.string().min(1).max(12000),
  scope: PreludeCardScopeSchema,
  characterId: z.string().min(1).nullable().optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  isActive: z.boolean().optional(),
  reason: z.string().min(1),
});

export const AdminPreludeCardPatchSchema = AdminPreludeCardCreateSchema.partial().extend({
  reason: z.string().min(1),
});

export const AdminPreludeCardResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  content: z.string(),
  scope: PreludeCardScopeSchema,
  characterId: z.string().nullable().optional(),
  priority: z.number(),
  isActive: z.boolean(),
  updatedAt: z.string(),
});

export const AdminPreludeCardsListResponseSchema = z.object({
  preludeCards: z.array(AdminPreludeCardResponseSchema),
});

// ── 星座编辑器（独立存储，按角色 slug） ──
// 写入 = 星座结构 + 变更原因；沿用 ConstellationSchema 的 id 唯一 / 边引用完整性校验。
export const AdminConstellationPutSchema = ConstellationSchema.and(
  z.object({ reason: z.string().min(1) }),
);

export const AdminConstellationResponseSchema = z.object({
  slug: z.string(),
  points: z.array(ConstellationPointSchema),
  edges: z.array(ConstellationEdgeSchema),
  updatedAt: z.string(),
  // custom = 已持久化的运营编辑；default = 尚未保存，返回的是内置默认作为编辑起点
  source: z.enum(['custom', 'default']),
});

export const AdminConstellationsListResponseSchema = z.object({
  constellations: z.array(AdminConstellationResponseSchema),
});

// ── Audit ──
export const AdminAuditEntrySchema = z.object({
  id: z.string(),
  ts: z.string(),
  action: z.string(),
  actor: z.string(),
  target: z.string().optional(),
  reason: z.string().optional(),
  payload: z.unknown().optional(),
});

// ── Types ──
export type AdminCharactersCreate = z.infer<typeof AdminCharactersCreateSchema>;
export type AdminCharactersPatch = z.infer<typeof AdminCharactersPatchSchema>;
export type AdminCharactersListResponse = z.infer<typeof AdminCharactersListResponseSchema>;
export type AdminCharacterImportMode = z.infer<typeof AdminCharacterImportModeSchema>;
export type AdminCharacterImportPayload = z.infer<typeof AdminCharacterImportPayloadSchema>;
export type AdminCharacterImportIssue = z.infer<typeof AdminCharacterImportIssueSchema>;
export type AdminCharacterImportPreviewRequest = z.infer<typeof AdminCharacterImportPreviewRequestSchema>;
export type AdminCharacterImportCommit = z.infer<typeof AdminCharacterImportCommitSchema>;
export type AdminCharacterImportPreviewResponse = z.infer<typeof AdminCharacterImportPreviewResponseSchema>;
export type AdminCharacterImportCommitResponse = z.infer<typeof AdminCharacterImportCommitResponseSchema>;
export type AdminPolicyPatch = z.infer<typeof AdminPolicyPatchSchema>;
export type AdminCandleGrant = z.infer<typeof AdminCandleGrantSchema>;
export type AdminQuotaGrant = z.infer<typeof AdminQuotaGrantSchema>;
export type AdminQuotaFreeLimit = z.infer<typeof AdminQuotaFreeLimitSchema>;
export type AdminQuotaSetUser = z.infer<typeof AdminQuotaSetUserSchema>;
export type AdminQuotaResetUser = z.infer<typeof AdminQuotaResetUserSchema>;
export type AdminQuotaExchangeToggle = z.infer<typeof AdminQuotaExchangeToggleSchema>;
export type AdminUsersFlags = z.infer<typeof AdminUsersFlagsSchema>;
export type AdminIfCodesCreate = z.infer<typeof AdminIfCodesCreateSchema>;
export type AdminIfCodesToggle = z.infer<typeof AdminIfCodesToggleSchema>;
export type AdminConfigEnvPatch = z.infer<typeof AdminConfigEnvPatchSchema>;
export type AdminConfigRuntimePatch = z.infer<typeof AdminConfigRuntimePatchSchema>;
export type AdminConfigTestLLM = z.infer<typeof AdminConfigTestLLMSchema>;
export type AdminLlmApi = z.infer<typeof AdminLlmApiSchema>;
export type AdminLlmApiTest = z.infer<typeof AdminLlmApiTestSchema>;
export type AdminLlmApiSelect = z.infer<typeof AdminLlmApiSelectSchema>;
export type AdminLlmApiSelectTask = z.infer<typeof AdminLlmApiSelectTaskSchema>;
export type AdminLlmReasoningEffort = z.infer<typeof AdminLlmReasoningEffortSchema>;
export type AdminPromptRelease = z.infer<typeof AdminPromptReleaseSchema>;
export type AdminPromptRollback = z.infer<typeof AdminPromptRollbackSchema>;
export type AdminSidecarConfigPatch = z.infer<typeof AdminSidecarConfigPatchSchema>;
export type AdminMembershipCyclePatch = z.infer<typeof AdminMembershipCyclePatchSchema>;
export type AdminMembershipPlanPatch = z.infer<typeof AdminMembershipPlanPatchSchema>;
export type AdminMembershipGrant = z.infer<typeof AdminMembershipGrantSchema>;
export type AdminMembershipCancel = z.infer<typeof AdminMembershipCancelSchema>;
export type PreludeCardScope = z.infer<typeof PreludeCardScopeSchema>;
export type AdminPreludeCardCreate = z.infer<typeof AdminPreludeCardCreateSchema>;
export type AdminPreludeCardPatch = z.infer<typeof AdminPreludeCardPatchSchema>;
export type AdminPreludeCardResponse = z.infer<typeof AdminPreludeCardResponseSchema>;
export type AdminPreludeCardsListResponse = z.infer<typeof AdminPreludeCardsListResponseSchema>;
export type AdminAuditEntry = z.infer<typeof AdminAuditEntrySchema>;
export type AdminConstellationPut = z.infer<typeof AdminConstellationPutSchema>;
export type AdminConstellationResponse = z.infer<typeof AdminConstellationResponseSchema>;
export type AdminConstellationsListResponse = z.infer<typeof AdminConstellationsListResponseSchema>;
