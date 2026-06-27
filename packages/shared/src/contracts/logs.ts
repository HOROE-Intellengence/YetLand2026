import { z } from 'zod';

export const LogsConversationRequestSchema = z.object({
  sessionId: z.string().optional(),
  messages: z.array(z.unknown()).optional(),
}).passthrough();

export const LogsConversationResponseSchema = z.object({
  ok: z.literal(true),
});

export type LogsConversationRequest = z.infer<typeof LogsConversationRequestSchema>;
export type LogsConversationResponse = z.infer<typeof LogsConversationResponseSchema>;
