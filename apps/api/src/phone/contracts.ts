import { z } from 'zod';

export const PhoneSourceSchema = z.enum([
  'chat', 'group_chat', 'moments', 'checkphone', 'diary', 'voice',
  'story', 'vn', 'adventure', 'reading', 'shopping', 'game', 'custom_app',
  'xiaohongshu', 'interview_magazine', 'cocreate', 'dwelling',
]);

export const PhoneMemoryScopeSchema = z.object({
  characterId: z.string().min(1).max(128),
  mode: z.enum(['main', 'if']).default('main'),
  branchId: z.string().min(1).max(128).optional(),
});

export const PhoneMemoryEventSchema = PhoneMemoryScopeSchema.extend({
  eventId: z.string().min(1).max(160),
  sourceApp: PhoneSourceSchema,
  text: z.string().trim().min(1).max(6000),
});
export type PhoneMemoryEvent = z.infer<typeof PhoneMemoryEventSchema>;

export interface PhoneMemoryReceipt {
  inputHash: string;
  userId: string;
  characterId: string;
  sourceApp: string;
  mode: 'main' | 'if';
  branchId?: string;
  status: 'pending' | 'complete' | 'failed';
  updatedAt: string;
}
