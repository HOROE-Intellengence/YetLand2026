import { z } from 'zod';

export const PhoneChatLogStatusSchema = z.enum(['processing', 'complete', 'failed', 'cancelled', 'interrupted']);
export const PhoneChatLogsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(100000).default(1),
  user: z.string().trim().max(128).optional(),
  character: z.string().trim().max(128).optional(),
  userId: z.string().max(128).optional(),
  characterId: z.string().max(128).optional(),
  branchId: z.string().max(200).optional(),
  status: PhoneChatLogStatusSchema.optional(),
  sourceApp: z.string().max(100).optional(), sessionId:z.string().max(200).optional(),
  q:z.string().trim().max(200).optional(), from:z.string().datetime().optional(), to:z.string().datetime().optional(),
  grouped:z.enum(['true','false']).optional(), order:z.enum(['asc','desc']).optional(),
});
export type PhoneChatLogsQuery = z.infer<typeof PhoneChatLogsQuerySchema>;
export const PhoneChatLogRowSchema = z.object({
  id: z.string(), userId: z.string(), userName: z.string(),
  characterId: z.string(), characterName: z.string(), branchId: z.string(),
  model: z.string(), createdAt: z.string(), status: PhoneChatLogStatusSchema,
  elapsedMs: z.number(), upstreamStatus: z.number().nullable(), errorCode: z.string().nullable(),
  truncated: z.number(), inputPreview: z.string(), outputPreview: z.string(),
  sourceApp:z.string().default('unknown'), sourceInferred:z.number().default(1),
  sessionId:z.string().default(''), operation:z.string().default(''), turnId:z.string().default(''), groupSize:z.number().optional(),
});
export const PhoneChatLogDetailSchema = PhoneChatLogRowSchema.extend({ request: z.string(), response: z.string() });
export const PhoneChatLogsPageSchema = z.object({
  items: z.array(PhoneChatLogRowSchema), total: z.number(), page: z.number(), pageSize: z.number(),
  sources:z.array(z.object({id:z.string(),count:z.number()})).default([]),
});
export type PhoneChatLogRow = z.infer<typeof PhoneChatLogRowSchema>;
export type PhoneChatLogDetail = z.infer<typeof PhoneChatLogDetailSchema>;
export type PhoneChatLogsPage = z.infer<typeof PhoneChatLogsPageSchema>;
