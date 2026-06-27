import { createOpenAILikeProvider } from './openai';
import type { LLMProvider } from '../types';

export function createDeepSeekProvider(apiKey: string | undefined, opts?: { baseUrl?: string; model?: string }): LLMProvider {
  return createOpenAILikeProvider({
    apiKey,
    name: 'deepseek',
    baseUrl: opts?.baseUrl ?? 'https://api.deepseek.com/v1',
    defaultModel: opts?.model ?? 'deepseek-chat',
  });
}
