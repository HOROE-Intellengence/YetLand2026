import { LlmRouter, type LlmProviderConfig } from '@yelan/llm';
import type { Env } from '../types/bindings';

export function createRouterFromEnv(env: Env): LlmRouter {
  const providers: LlmProviderConfig[] = [];

  if (env.ANTHROPIC_API_KEY) {
    providers.push({
      id: 'anthropic',
      protocol: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: 'https://api.anthropic.com',
      model: 'claude-sonnet-4-6',
    });
  }
  if (env.OPENAI_API_KEY) {
    providers.push({
      id: 'openai',
      protocol: 'openai-compatible',
      apiKey: env.OPENAI_API_KEY,
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4o-mini',
    });
  }
  if (env.DEEPSEEK_API_KEY) {
    providers.push({
      id: 'deepseek',
      protocol: 'openai-compatible',
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: 'https://api.deepseek.com/v1',
      model: 'deepseek-chat',
    });
  }
  if (env.UNLIM_WORKER_URL) {
    providers.push({
      id: 'nvidia-unlim',
      protocol: 'nvidia',
      apiKey: '',
      baseUrl: env.UNLIM_WORKER_URL,
      model: 'nvidia/unlim',
    });
  }

  return new LlmRouter({ providers, mainProviderId: providers[0]?.id ?? null });
}
