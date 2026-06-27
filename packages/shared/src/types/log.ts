// 服务端 conversation_logs 行（与本地记忆系统分离）
import type { ConversationMode } from './session';
import type { Stage } from '../enums/stage';

export interface ConversationLogRow {
  id?: string;
  userId: string;
  sessionId: string;
  characterId: string;
  mode: ConversationMode;
  stage: Stage;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokenCount: number;
  model: string;
  costDecimal: number;
  createdAt: string;
}
