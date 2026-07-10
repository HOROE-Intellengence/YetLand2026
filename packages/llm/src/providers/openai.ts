import type { LLMProvider, CompletionRequest, CompletionChunk } from '../types';
import { createStreamGuard } from '../stream-guard';

export interface OpenAILikeOptions {
  apiKey: string | undefined;
  name?: string;
  baseUrl?: string;
  defaultModel?: string;
}

/**
 * reasoning_effort 守卫：只有已知支持该参数的模型族才把它写进 body，
 * 避免发给不认识它的代理/模型（如 deepseek-chat、gpt-4o-mini）直接 400。
 * 已知支持：Gemini 3 / 3.x（OpenAI 兼容层自动映射到 thinking_level）、
 * OpenAI gpt-5 与 o 系列推理模型。其余一律不带。
 */
function modelAcceptsReasoningEffort(model: string): boolean {
  return /gemini-[3-9]|gpt-5|^o[1-9]\b|^gpt-o/i.test(model);
}

export function createOpenAILikeProvider(opts: OpenAILikeOptions): LLMProvider {
  const apiKey = opts.apiKey;
  const ready = !!apiKey && apiKey.length > 10;
  const name = opts.name ?? 'openai';
  // baseUrl 归一：约定 baseUrl = API 根（如 .../v1），下方再拼 /chat/completions。
  // 容错管理员在后台直接粘贴了完整 .../v1/chat/completions —— 去掉重复后缀，
  // 否则会拼成 .../chat/completions/chat/completions 直接 404。
  const baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1')
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/, '');
  const defaultModel = opts.defaultModel ?? 'gpt-4o-mini';

  const provider: LLMProvider = {
    name,
    ready,

    async *stream(req: CompletionRequest, signal?: AbortSignal): AsyncIterable<CompletionChunk> {
      if (!ready) throw new Error(`${name}: API key missing`);

      const guard = createStreamGuard(signal);

      try {
        const model = req.model || defaultModel;
        // reasoning_effort 仅在显式提供 + 模型族已知支持时才进 body；
        // 否则保持原样，兼容不认识该参数的代理/模型。
        const body: Record<string, unknown> = {
          model,
          messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
          temperature: req.temperature ?? 0.8,
          max_tokens: req.maxTokens ?? 1024,
          stream: true,
        };
        if (req.reasoningEffort && modelAcceptsReasoningEffort(model)) {
          body.reasoning_effort = req.reasoningEffort;
        }

        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
          signal: guard.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '');
          throw new Error(`${name} ${res.status}: ${text.slice(0, 200)}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        let streamEnded = false;

        while (!streamEnded) {
          const { value, done } = await reader.read();
          if (done) break;
          guard.keepAlive();
          buf += decoder.decode(value, { stream: true });

          let nl: number;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload) continue;
            if (payload === '[DONE]') {
              streamEnded = true;
              break;
            }

            try {
              const ev = JSON.parse(payload) as {
                choices?: Array<{ delta?: { content?: string } }>;
              };
              const text = ev.choices?.[0]?.delta?.content;
              if (text) yield { text };
            } catch {
              /* ignore malformed line */
            }
          }
        }
      } finally {
        guard.dispose();
      }
    },

    async complete(req: CompletionRequest, signal?: AbortSignal): Promise<{ text: string; usage?: { inputTokens: number; outputTokens: number } }> {
      let text = '';
      for await (const chunk of provider.stream(req, signal)) text += chunk.text;
      return { text };
    },
  };

  return provider;
}

export function createOpenAIProvider(apiKey: string | undefined, opts?: { baseUrl?: string; model?: string }): LLMProvider {
  return createOpenAILikeProvider({
    apiKey,
    name: 'openai',
    baseUrl: opts?.baseUrl ?? 'https://api.openai.com/v1',
    defaultModel: opts?.model ?? 'gpt-4o-mini',
  });
}
