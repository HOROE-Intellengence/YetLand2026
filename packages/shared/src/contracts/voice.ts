import { z } from 'zod';

export const VoiceNameSchema = z.enum(['Charon', 'Puck', 'Gacrux', 'Leda']);
export const DEFAULT_VOICE_NAME = 'Leda' as const;
export const VOICE_OPTIONS = [
  { value: 'Charon', label: '沉稳男声' }, { value: 'Puck', label: '清朗男声' },
  { value: 'Gacrux', label: '成熟女声' }, { value: 'Leda', label: '轻盈女声' },
] as const;
export const VoiceSessionCreateSchema = z.object({
  characterId: z.string().min(1).max(100),
  // Accepted for older clients; the server always uses the character binding.
  voiceName: VoiceNameSchema.optional(),
}).strict();
export const VoiceRequestIdSchema = z.string().uuid();
export const VoiceTextInputSchema = z.object({ text: z.string().trim().min(1).max(4000) }).strict();
export const VoiceTurnStatusSchema = z.enum(['processing', 'complete', 'failed', 'interrupted']);
export const VoiceTurnResponseSchema = z.object({
  id: z.string(), sessionId: z.string(), requestId: z.string(),
  status: VoiceTurnStatusSchema, createdAt: z.string(), updatedAt: z.string(),
  inputText: z.string(), outputText: z.string(),
  inputTranscriptComplete: z.boolean(), outputTranscriptComplete: z.boolean(),
  inputAudioUrl: z.string().nullable(), outputAudioUrl: z.string().nullable(),
  errorCode: z.string().nullable(),
});
export type VoiceName = z.infer<typeof VoiceNameSchema>;
export type VoiceTurnResponse = z.infer<typeof VoiceTurnResponseSchema>;

export const VoiceAsrLinkResponseSchema = z.union([
  z.object({ skipped: z.literal(true), reason: z.literal('LOCAL_SIGNATURE_SKIPPED'), url: z.null(), expiresAt: z.null() }),
  z.object({ skipped: z.literal(false), url: z.string().url(), expiresAt: z.string().datetime() }),
]);
export type VoiceAsrLinkResponse = z.infer<typeof VoiceAsrLinkResponseSchema>;
