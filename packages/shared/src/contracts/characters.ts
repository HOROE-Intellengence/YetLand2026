import { HqVoiceProfileIdSchema } from './voice-hq';
import { z } from 'zod';
import { VoiceNameSchema } from './voice';

// ── 星座 ──
// x 横向 0..100；y 纵向 -40..100（负值浮于卡片上边界之上，与渲染 viewBox "0 -40 100 140" 对齐）。
export const ConstellationPointSchema = z.object({
  id: z.string().min(1).max(40),
  x: z.number().min(0).max(100),
  y: z.number().min(-40).max(100),
});

export const ConstellationEdgeSchema = z.object({
  from: z.string().min(1).max(40),
  to: z.string().min(1).max(40),
});

// 点 id 唯一 + 边两端必须引用已存在的点 —— 公共响应与 admin 写入共用此校验。
export function refineConstellation(
  val: { points: { id: string }[]; edges: { from: string; to: string }[] },
  ctx: z.RefinementCtx,
): void {
  const ids = new Set<string>();
  val.points.forEach((p, i) => {
    if (ids.has(p.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `重复的星点 id：${p.id}`, path: ['points', i, 'id'] });
    }
    ids.add(p.id);
  });
  val.edges.forEach((e, i) => {
    if (!ids.has(e.from)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `连边 from 引用了不存在的星点：${e.from}`, path: ['edges', i, 'from'] });
    }
    if (!ids.has(e.to)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `连边 to 引用了不存在的星点：${e.to}`, path: ['edges', i, 'to'] });
    }
  });
}

export const ConstellationSchema = z
  .object({
    points: z.array(ConstellationPointSchema).max(64),
    edges: z.array(ConstellationEdgeSchema).max(128),
  })
  .superRefine(refineConstellation);

// ── Request ──
const CharacterResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  rarity: z.enum(['free', 'paid', 'hidden']),
  priceCandle: z.number(),
  styleTags: z.array(z.string()),
  promptCardKey: z.string().optional(),
  voiceName: VoiceNameSchema.optional(),
  hqVoiceProfileId: HqVoiceProfileIdSchema.optional(),
  boundaryDefault: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
  isActive: z.boolean(),
  openingLines: z.object({
    firstVisit: z.string(),
    returnVisit: z.string(),
  }),
  description: z.string().optional(),
  forbiddenPhrases: z.array(z.string()).optional(),
  updatedAt: z.string().optional(),
  constellation: ConstellationSchema.optional(),
});

export const CharactersListResponseSchema = z.array(CharacterResponseSchema);

export const CharacterDetailResponseSchema = CharacterResponseSchema;

export const CharacterUnlockResponseSchema = z.union([
  z.object({ ok: z.literal(true), alreadyFree: z.boolean().optional() }),
  z.object({ code: z.enum(['NOT_FOUND', 'INSUFFICIENT_CANDLE']), message: z.string() }),
]);

export type CharactersListResponse = z.infer<typeof CharactersListResponseSchema>;
export type CharacterDetailResponse = z.infer<typeof CharacterDetailResponseSchema>;
export type CharacterUnlockResponse = z.infer<typeof CharacterUnlockResponseSchema>;
export type ConstellationPointInput = z.infer<typeof ConstellationPointSchema>;
export type ConstellationEdgeInput = z.infer<typeof ConstellationEdgeSchema>;
