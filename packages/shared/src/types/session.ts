import type { Stage } from '../enums/stage';

export type ConversationMode = 'main' | 'if';

export interface ConversationSession {
  id: string;
  userId: string;
  characterId: string;
  mode: ConversationMode;
  stage: Stage;
  lastMessageAt: string;
  createdAt: string;
}
