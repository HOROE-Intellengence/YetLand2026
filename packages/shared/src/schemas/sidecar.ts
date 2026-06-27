import { z } from 'zod';

export const MessagePartTypeSchema = z.enum(['dialogue', 'action', 'environment', 'narration']);

export const StructuredMessagePartSchema = z.object({
  type: MessagePartTypeSchema,
  text: z.string(),
});

export const OutputStructurerResultSchema = z.object({
  parts: z.array(StructuredMessagePartSchema),
});

export const AtmosphereResultSchema = z.object({
  temperature: z.number().int().min(1).max(5),
});

export const PreferenceCategorySchema = z.enum(['address', 'boundary', 'preference', 'fact', 'relationship', 'other']);

export const PreferenceRecordPreferenceSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    category: z.string().optional(),
  }),
]);

export const PreferenceRecordResultSchema = z.object({
  preferences: z.array(PreferenceRecordPreferenceSchema),
  events: z.array(z.object({ date: z.string(), text: z.string(), emotion: z.string().optional() })),
  relationshipState: z.string().optional(),
  summary: z.string(),
});

export const QuotaEndingResultSchema = z.object({
  closingInstruction: z.string(),
});

export const ContextCompressResultSchema = z.object({
  summary: z.string(),
});

export const SidecarPromptKeySchema = z.enum([
  'preferenceRecorder',
  'outputStructurer',
  'atmosphereJudge',
  'quotaEnding',
  'contextCompressor',
]);

export const AdminSidecarPromptPatchSchema = z.object({
  value: z.string().min(1),
  reason: z.string().min(1),
});
