export { PhoneSourceSchema, PhoneMemoryScopeSchema, PhoneMemoryEventSchema } from '@yelan/shared';
export type { PhoneMemoryEvent } from '@yelan/shared';

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
