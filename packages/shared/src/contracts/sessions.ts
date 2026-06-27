import { z } from 'zod';

const ConversationModeSchema = z.enum(['main', 'if']);
const StageSchema = z.enum(['daily', 'rise', 'climax', 'after', 'end']);

export const SessionCreateRequestSchema = z.object({
  characterId: z.string().min(1).optional(),
  mode: ConversationModeSchema.optional(),
});

export const SessionResponseSchema = z.object({
  id: z.string(),
  userId: z.string(),
  characterId: z.string(),
  mode: ConversationModeSchema,
  ifActive: z.boolean().optional(),
  round: z.number().int().nonnegative(),
  prevStage: StageSchema,
  lastMemoryRound: z.number().int().nonnegative().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const RecentSessionResponseSchema = SessionResponseSchema.nullable();

export const SessionMessageResponseSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string(),
});

export const SessionMessagesResponseSchema = z.array(SessionMessageResponseSchema);

export type SessionCreateRequest = z.infer<typeof SessionCreateRequestSchema>;
export type SessionResponse = z.infer<typeof SessionResponseSchema>;
export type RecentSessionResponse = z.infer<typeof RecentSessionResponseSchema>;
export type SessionMessageResponse = z.infer<typeof SessionMessageResponseSchema>;
export type SessionMessagesResponse = z.infer<typeof SessionMessagesResponseSchema>;
