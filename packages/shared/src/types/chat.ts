import type { Stage } from '../enums/stage';
import type { Boundary } from '../enums/boundary';
import type { RecallPayload } from './recall';
import type { StructuredMessagePart } from './sidecar';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  cacheControl?: { type: 'ephemeral' };
}

export interface ChatRequest {
  characterId: string;
  sessionId: string;
  round: number;
  prevStage: Stage;
  userBoundary: Boundary;
  text: string;
  history: ChatMessage[];
  recall?: RecallPayload;
  cutoffWarning?: boolean;
}

// SSE 事件协议 — 服务端 / mock / 前端必须严格对齐
export type ChatStreamEvent =
  | { kind: 'meta'; stage: Stage; boundary: Boundary; ifActive?: boolean; requestId?: string; llmMode?: string; tokenGuard?: string; mainProviderId?: string; mainModel?: string }
  | { kind: 'atmosphere'; temperature: number; requestId?: string }
  | { kind: 'chunk'; text: string; sentenceEnd?: boolean; glow?: boolean; requestId?: string }
  | { kind: 'structured'; parts: StructuredMessagePart[]; rawText: string; source?: 'sidecar' | 'fallback'; degradeReason?: string; requestId?: string }
  | { kind: 'achievement'; slug: string; requestId?: string }
  | { kind: 'cutoff'; reason: 'quota' | 'cost' | 'boundary'; requestId?: string }
  | { kind: 'error'; code: string; message: string; requestId?: string }
  | { kind: 'done'; requestId?: string };
