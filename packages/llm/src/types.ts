import type { ChatMessage } from '@yelan/shared';

export type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  cacheControl?: { type: 'ephemeral' };
  /**
   * 推理档位。仅在显式提供时才会出现在请求 body 的 reasoning_effort 字段里。
   * 对 Gemini OpenAI 兼容层（gemini-3.1-flash-lite 等）会自动映射到 thinking_level；
   * 不传 ≈ 模型默认（flash-lite 默认 minimal）。详见 providers/openai.ts 的守卫。
   */
  reasoningEffort?: ReasoningEffort;
}

export interface CompletionChunk {
  text: string;
  finished?: boolean;
  usage?: { inputTokens: number; outputTokens: number };
  /** 实际应答的 provider ID（路由追踪） */
  providerId?: string;
  /** 实际应答的 model（路由追踪） */
  model?: string;
}

export interface LLMProvider {
  name: string;
  ready: boolean;
  stream(req: CompletionRequest, signal?: AbortSignal): AsyncIterable<CompletionChunk>;
  complete(req: CompletionRequest, signal?: AbortSignal): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }>;
}
