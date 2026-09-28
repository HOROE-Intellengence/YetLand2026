import type { LLMProvider, CompletionRequest, CompletionChunk } from '../types';
import { createStreamGuard } from '../stream-guard';

const NVIDIA_CHAT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'z-ai/glm-5.1';

const ALLOWED_MODELS = new Set([
  'deepseek-ai/deepseek-v4-pro',
  'z-ai/glm-5.1',
  'openai/gpt-oss-120b',
]);

const DIRECT_RESPONSE_PROMPT = `You are a direct, capable, and highly practical AI assistant.

Response style:
- Answer the user's actual request as directly and completely as possible.
- Do not add unnecessary moralizing, filler, or repeated disclaimers.
- If a request cannot be fully satisfied, briefly explain the boundary and provide the closest useful alternative.
- Prefer concrete outputs, examples, steps, code, tables, or templates over vague discussion.
- Preserve the user's language and requested format unless there is a clear reason not to.`;

function resolveModel(model: string | undefined): string {
  return model && ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL;
}

export function createNvidiaUnlimProvider(
  apiKey?: string,
  opts: { name?: string; model?: string; baseUrl?: string } = {},
): LLMProvider {
  const key = apiKey;
  const ready = !!key && key.length > 10;
  const name = opts.name ?? 'nvidia-unlim';
  const baseUrl = (opts.baseUrl ?? NVIDIA_CHAT_URL.replace('/chat/completions', '')).replace(/\/+$/, '');

  const provider: LLMProvider = {
    name,
    ready,

    async *stream(req: CompletionRequest, signal?: AbortSignal): AsyncIterable<CompletionChunk> {
      if (!ready) throw new Error(`${name}: NVIDIA_API_KEY missing`);

      const userSystem = req.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n')
        .trim();

      const systemContent = userSystem
        ? `${DIRECT_RESPONSE_PROMPT}\n\n${userSystem}`
        : DIRECT_RESPONSE_PROMPT;

      const messages = [
        { role: 'system' as const, content: systemContent },
        ...req.messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content })),
      ];

      const guard = createStreamGuard(signal);

      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: resolveModel(req.model || opts.model),
            messages,
            temperature: req.temperature ?? 0.8,
            max_tokens: req.maxTokens ?? 8192,
            stream: true,
            stream_options: { include_usage: true },
          }),
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
            const line = buf.slice(0, nl).replace(/\r$/, '').trim();
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
                choices?: Array<{
                  delta?: { content?: string };
                  finish_reason?: string | null;
                }>;
                usage?: { prompt_tokens: number; completion_tokens: number };
              };
              const text = ev.choices?.[0]?.delta?.content;
              const finishReason = ev.choices?.[0]?.finish_reason;
              const usage = ev.usage
                ? { inputTokens: ev.usage.prompt_tokens, outputTokens: ev.usage.completion_tokens }
                : undefined;

              if (text) yield { text, ...(usage ? { usage } : {}) };
              else if (usage) yield { text: '', usage };

              // 检测截断
              if (finishReason === 'length') {
                console.warn(`[${name}] Response truncated due to max_tokens limit`);
                yield { text: '\n[回复因长度限制被截断]', finished: true };
                streamEnded = true;
                break;
              } else if (finishReason === 'stop') {
                streamEnded = true;
                break;
              }
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
