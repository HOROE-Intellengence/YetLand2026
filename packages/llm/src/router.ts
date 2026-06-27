import type { Stage } from '@yelan/shared';
import type { LLMProvider, CompletionRequest, CompletionChunk } from './types';
import type { LlmProviderConfig, LlmRouterConfig } from './config';
import { createAnthropicProvider } from './providers/anthropic';
import { createOpenAILikeProvider, createOpenAIProvider } from './providers/openai';
import { createDeepSeekProvider } from './providers/deepseek';
import { createNvidiaUnlimProvider } from './providers/nvidia-unlim';
import { sanitizeCompletionStream } from './think-sanitizer';
import type { SanitizerStats } from './think-sanitizer';

function createProviderFromConfig(config: LlmProviderConfig): LLMProvider {
  if (config.protocol === 'anthropic') {
    return createAnthropicProvider(config.apiKey, {
      name: config.id,
      model: config.model,
      baseUrl: config.baseUrl,
    });
  }
  if (config.protocol === 'nvidia') {
    return createNvidiaUnlimProvider(config.apiKey, {
      name: config.id,
      model: config.model,
      baseUrl: config.baseUrl,
    });
  }
  return createOpenAILikeProvider({
    apiKey: config.apiKey,
    name: config.id,
    baseUrl: config.baseUrl,
    defaultModel: config.model,
  });
}

export class LlmRouter {
  readonly providers: Map<string, LLMProvider>;
  readonly mainProviderId: string | null;

  constructor(private config: LlmRouterConfig) {
    this.mainProviderId = config.mainProviderId;
    this.providers = new Map<string, LLMProvider>();

    for (const c of config.providers) {
      this.providers.set(c.id, createProviderFromConfig(c));
    }
  }

  hasReady(): boolean {
    for (const p of this.providers.values()) if (p.ready) return true;
    return false;
  }

  pickChain(stage: Stage): string[] {
    const all = Array.from(this.providers.keys());
    const order = this.mainProviderId
      ? [this.mainProviderId, ...all.filter((id) => id !== this.mainProviderId)]
      : all;
    return order.filter((n) => this.providers.get(n)?.ready);
  }

  getMainModel(): string | null {
    const mainCfg = this.mainProviderId
      ? this.config.providers.find((c) => c.id === this.mainProviderId)
      : this.config.providers[0];
    return mainCfg?.model ?? null;
  }

  pickAny(): string[] {
    return Array.from(this.providers.entries())
      .filter(([, p]) => p.ready)
      .map(([n]) => n);
  }

  async *stream(
    stage: Stage,
    req: CompletionRequest,
    signal?: AbortSignal,
    onStats?: (stats: SanitizerStats) => void,
  ): AsyncIterable<CompletionChunk> {
    const chain = this.pickChain(stage).length ? this.pickChain(stage) : this.pickAny();
    if (chain.length === 0) throw new Error('no provider ready');

    let lastError: unknown = null;
    for (const name of chain) {
      const p = this.providers.get(name);
      if (!p) continue;
      const providerCfg = this.config.providers.find((c) => c.id === name);
      try {
        for await (const chunk of sanitizeCompletionStream(p.stream(req, signal), onStats)) {
          yield { ...chunk, providerId: name, model: providerCfg?.model };
        }
        return;
      } catch (e) {
        lastError = e;
        console.warn(`[llm-router] ${name} failed:`, (e as Error).message);
      }
    }
    throw lastError instanceof Error ? lastError : new Error('all providers failed');
  }
}

/** 便捷工厂：从环境变量创建路由器（用于简单场景，复杂配置请用 LlmRouterConfig） */
export function createRouterFromEnv(env: Record<string, string | undefined>): LlmRouter {
  const providers: LlmProviderConfig[] = [];

  if (env.ANTHROPIC_API_KEY) {
    providers.push({
      id: 'anthropic',
      protocol: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      model: env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',
    });
  }
  if (env.OPENAI_API_KEY) {
    providers.push({
      id: 'openai',
      protocol: 'openai-compatible',
      apiKey: env.OPENAI_API_KEY,
      baseUrl: env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      model: env.OPENAI_MODEL || 'gpt-4o-mini',
    });
  }
  if (env.DEEPSEEK_API_KEY) {
    providers.push({
      id: 'deepseek',
      protocol: 'openai-compatible',
      apiKey: env.DEEPSEEK_API_KEY,
      baseUrl: env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1',
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
    });
  }
  if (env.NVIDIA_API_KEY) {
    providers.push({
      id: 'nvidia-unlim',
      protocol: 'nvidia',
      apiKey: env.NVIDIA_API_KEY,
      baseUrl: env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com',
      model: env.NVIDIA_DEFAULT_MODEL || 'z-ai/glm-5.1',
    });
  }

  return new LlmRouter({ providers, mainProviderId: providers[0]?.id ?? null });
}
