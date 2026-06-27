import { ChatStreamEventSchema, type ChatRequest, type ChatStreamEvent } from '@yelan/shared';
import { env } from '../config/env';
import { getToken } from './client';
import { track } from './events';

export async function* openChatStream(
  body: ChatRequest,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent> {
  const token = getToken();
  const res = await fetch(env.apiBase + '/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    credentials: 'include',
    signal,
  });

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '');
    track({
      name: 'api_error',
      ts: Date.now(),
      payload: { endpoint: '/api/chat', status: res.status, message: text.slice(0, 200) },
    });
    yield {
      kind: 'error',
      code: `HTTP_${res.status}`,
      message: text.slice(0, 200) || res.statusText,
    };
    yield { kind: 'done' };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let streamEndedCleanly = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nlIdx: number;
      while ((nlIdx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nlIdx).replace(/\r$/, '');
        buf = buf.slice(nlIdx + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;

        try {
          const parsed = ChatStreamEventSchema.safeParse(JSON.parse(payload));
          if (parsed.success) {
            if (parsed.data.kind === 'done') streamEndedCleanly = true;
            yield parsed.data;
          } else {
            track({
              name: 'sse_error',
              ts: Date.now(),
              payload: { code: 'INVALID_STREAM_EVENT', message: parsed.error.issues[0]?.message },
            });
            yield {
              kind: 'error',
              code: 'INVALID_STREAM_EVENT',
              message: parsed.error.issues[0]?.message ?? 'invalid stream event',
            };
          }
        } catch {
          track({
            name: 'sse_error',
            ts: Date.now(),
            payload: { code: 'MALFORMED_STREAM_EVENT' },
          });
          yield { kind: 'error', code: 'MALFORMED_STREAM_EVENT', message: 'malformed stream event' };
        }
      }
    }
  } finally {
    if (!streamEndedCleanly) {
      track({
        name: 'sse_error',
        ts: Date.now(),
        payload: { code: 'STREAM_DISCONNECTED', message: 'SSE stream ended without done event' },
      });
    }
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }
}
