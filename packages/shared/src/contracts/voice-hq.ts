import { z } from 'zod';
import { VoiceTurnResponseSchema } from './voice';

export const HqVoiceProfileIdSchema = z.enum(['mature-female', 'mature-male', 'young-male', 'young-female']);
export type HqVoiceProfileId = z.infer<typeof HqVoiceProfileIdSchema>;
export const HQ_VOICE_OPTIONS = [
  { value: 'mature-female', label: '成熟女' },
  { value: 'mature-male', label: '成熟男' },
  { value: 'young-male', label: '少年男' },
  { value: 'young-female', label: '少女' },
] as const;
export function defaultHqVoiceProfile(voiceName?: string): HqVoiceProfileId {
  return voiceName === 'Charon' ? 'mature-male' : voiceName === 'Puck' ? 'young-male'
    : voiceName === 'Gacrux' ? 'mature-female' : 'young-female';
}
export const HqSessionCreateSchema = z.object({ characterId: z.string().min(1).max(100) }).strict();
export const HqTextInputSchema = z.object({ text: z.string().trim().min(1).max(4000) }).strict();
export const HqStageSchema = z.enum(['uploading', 'asr_skipped', 'asr_submitting', 'asr_pending', 'main', 'tts', 'complete', 'failed', 'interrupted']);
export const HqTurnResponseSchema = VoiceTurnResponseSchema.extend({
  stage: HqStageSchema, profileId: HqVoiceProfileIdSchema, mainCompleted: z.boolean(),
  canRetryTts: z.boolean(), canResumeAsr: z.boolean(), localAsrSkipped: z.boolean(),
  ifActive: z.boolean(), temperature: z.number().int().min(1).max(5).nullable(),
  timings: z.record(z.number()),
});
export type HqTurnResponse = z.infer<typeof HqTurnResponseSchema>;
export const HqSessionResponseSchema = z.object({ id: z.string(), characterId: z.string(),
  profileId: HqVoiceProfileIdSchema, closedAt: z.string().nullable(), localTest: z.boolean(), ifActive: z.boolean() });
export type HqSessionResponse = z.infer<typeof HqSessionResponseSchema>;

export const FishReferenceIdSchema = z.string().trim().regex(/^[a-zA-Z0-9_-]{1,100}$/);
export const FishSlotWriteSchema = z.object({ referenceId: FishReferenceIdSchema.nullable(),
  speed: z.number().min(0.5).max(1.5).default(1), reason: z.string().trim().min(1).max(500) }).strict();
export const FishPreviewSchema = z.object({ referenceId: FishReferenceIdSchema.nullable().default(null),
  text: z.string().trim().min(1).max(300), speed: z.number().min(0.5).max(1.5).default(1) }).strict();
export interface FishVoiceSlot { category: HqVoiceProfileId; referenceId: string | null; speed: number; revision: number }
export interface FishVoiceSettings { provider: 'fish'; model: 's2.1-pro-free'; configured: boolean; slots: FishVoiceSlot[] }
export interface FishCatalog { total: number; hasMore?: boolean; items: Array<{ referenceId: string; name: string; languages: string[]; tags: string[] }> }
export const FishCatalogQuerySchema = z.object({ title: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1), self: z.enum(['true', 'false']).default('false') });
