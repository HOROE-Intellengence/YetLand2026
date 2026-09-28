import type { LLMProvider, CompletionRequest, CompletionChunk } from '../types';
import { createStreamGuard } from '../stream-guard';

export function createAnthropicProvider(
  apiKey: string | undefined,
  opts: { name?: string; model?: string; baseUrl?: string } = {},
): LLMProvider {
  const ready = !!apiKey && apiKey.length > 10;
  const name = opts.name ?? 'anthropic';
  const model = opts.model || 'claude-sonnet-4-6';
  const baseUrl = (opts.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');

  return {
    name,
    ready,

    async *stream(req: CompletionRequest, signal?: AbortSignal): AsyncIterable<CompletionChunk> {
      if (!ready) throw new Error(`${name}: API key missing`);

      const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const messages = req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }));

      const guard = createStreamGuard(signal);

      try {
        const res = await fetch(`${baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey!,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: req.model || model,
            system,
            messages,
            max_tokens: req.maxTokens ?? 8192,
            temperature: req.temperature ?? 0.8,
            stream: true,
          }),
          signal: guard.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text().catch(() => '');
          throw new Error(`anthropic ${res.status}: ${text.slice(0, 200)}`);
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
            if (!payload || payload === '[DONE]') continue;

            try {
              const ev = JSON.parse(payload) as {
                type?: string;
                delta?: { type?: string; text?: string };
                message?: { stop_reason?: string };
              };
              if (ev.type === 'message_stop') {
                streamEnded = true;
                break;
              }
              if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) {
                yield { text: ev.delta.text };
              }
              // Anthropic 的 message_delta 事件包含 stop_reason
              if (ev.type === 'message_delta' && ev.delta) {
                const stopReason = (ev.delta as { stop_reason?: string }).stop_reason;
                if (stopReason === 'max_tokens') {
                  console.warn(`[${name}] Response truncated due to max_tokens limit`);
                  yield { text: '\n[回复因长度限制被截断]', finished: true };
                  streamEnded = true;
                  break;
                }
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
      for await (const chunk of this.stream(req, signal)) text += chunk.text;
      return { text };
    },
  };
}
