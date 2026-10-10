import { randomUUID } from 'node:crypto';
import type { ApiCompletion } from '@yelan/shared';
import { API_PUBLIC_MODELS } from '@yelan/shared';
import { type GatewayDatabase, GatewayError } from './database';
import type { KeyRow } from './database';
import type { Upstream } from './service';

// Rewrite only protocol metadata, never assistant text or archived upstream bytes.
class PublicModelStream {
  private decoder = new TextDecoder();
  private encoder = new TextEncoder();
  private buffer = '';
  constructor(private model: string) {}
  private rewrite(event: string): string {
    const lines = event.split(/\r?\n/);
    const data = lines.filter((line) => line.startsWith('data:'));
    if (!data.length) return event;
    try {
      const value = JSON.parse(data.map((line) => line.slice(5).trimStart()).join('\n'));
      if (!value || typeof value !== 'object' || !('model' in value)) return event;
      value.model = this.model;
      let emitted = false;
      return lines
        .filter((line) => {
          if (!line.startsWith('data:')) return true;
          if (emitted) return false;
          emitted = true;
          return true;
        })
        .map((line) => (line.startsWith('data:') ? `data: ${JSON.stringify(value)}` : line))
        .join(event.includes('\r\n') ? '\r\n' : '\n');
    } catch {
      return event;
    }
  }
  feed(bytes: Uint8Array): Uint8Array {
    this.buffer += this.decoder.decode(bytes, { stream: true });
    let output = '';
    let boundary: RegExpExecArray | null;
    while ((boundary = /\r?\n\r?\n/.exec(this.buffer))) {
      output += this.rewrite(this.buffer.slice(0, boundary.index)) + boundary[0];
      this.buffer = this.buffer.slice(boundary.index + boundary[0].length);
    }
    return this.encoder.encode(output);
  }
  flush(): Uint8Array {
    const output = this.rewrite(this.buffer + this.decoder.decode());
    this.buffer = '';
    return this.encoder.encode(output);
  }
}

// Observe SSE without changing bytes. Keep real upstream responses separate from client-supplied history.
export class SseObserver {
  private decoder = new TextDecoder();
  private buffer = '';
  text = '';
  done = false;
  error = false;
  usage?: Record<string, unknown>;
  feed(bytes: Uint8Array) {
    this.buffer += this.decoder.decode(bytes, { stream: true });
    if (this.buffer.length > 4 * 1024 * 1024)
      throw new GatewayError('UPSTREAM_EVENT_TOO_LARGE', 502, '上游事件过大');
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const event = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const data = event
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n');
      if (data === '[DONE]') {
        this.done = true;
        continue;
      }
      if (!data) continue;
      try {
        const value = JSON.parse(data);
        if (value.error) this.error = true;
        const content = value.choices?.find((x: { index?: number }) => !x.index)?.delta?.content;
        if (typeof content === 'string') this.text += content;
        if (value.usage && typeof value.usage === 'object') this.usage = value.usage;
      } catch {
        this.error = true;
      }
    }
  }
}

export async function forwardCompletion(
  db: GatewayDatabase,
  key: KeyRow,
  body: ApiCompletion,
  upstream: Upstream,
  clientSignal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  const settings = db.settings();
  if (!settings.enabled) throw new GatewayError('GATEWAY_DISABLED', 503, 'API 服务暂时停用');
  const publicModel = API_PUBLIC_MODELS[key.tier];
  // Keep existing clients working; public aliases may only select the Key's tier.
  if (body.model !== publicModel && body.model !== upstream.model)
    throw new GatewayError('MODEL_NOT_FOUND', 404, '模型不存在或与 Key 版本不匹配');
  const published = key.tier === 'advanced' ? db.published() : undefined;
  if (key.tier === 'advanced' && !published)
    throw new GatewayError('PRELUDE_NOT_PUBLISHED', 503, '高级版前置尚未发布');
  const upstreamBody = {
    ...body,
    model: upstream.model,
    ...(published
      ? { messages: [{ role: 'system', content: published.content }, ...body.messages] }
      : {}),
  };
  const id = randomUUID();
  const started = Date.now();
  db.begin(key, {
    id,
    request: JSON.stringify(body),
    upstreamRequest: JSON.stringify(upstreamBody),
    upstreamId: upstream.id,
    model: body.model,
    promptVersion: published?.id ?? null,
    stream: body.stream === true,
  });
  const controller = new AbortController();
  let clientClosed = false;
  let finished = false;
  let timedOut = false;
  let seq = 0;
  let bytesReceived = 0;
  let outputController: ReadableStreamDefaultController<Uint8Array> | undefined;
  let upstreamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const observer = new SseObserver();
  const publicStream = new PublicModelStream(publicModel);
  const onAbort = () => {
    clientClosed = true;
    controller.abort();
    if (outputController && !finished) {
      finish('interrupted', 200, 'CLIENT_DISCONNECTED');
      outputController.error(new Error('Client disconnected'));
      void upstreamReader?.cancel().catch(() => {});
    }
  };
  clientSignal.addEventListener('abort', onAbort, { once: true });
  if (clientSignal.aborted) onAbort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
    if (outputController && !finished) {
      finish('failed', 200, 'UPSTREAM_TIMEOUT');
      outputController.error(new Error('Upstream timeout'));
      void upstreamReader?.cancel().catch(() => {});
    }
  }, settings.timeoutSeconds * 1000);
  const finish = (
    status: string,
    httpStatus: number,
    errorCode?: string,
    response?: string,
    usage = observer.usage,
    outputText = observer.text,
  ) => {
    if (finished) return;
    clearTimeout(timer);
    clientSignal.removeEventListener('abort', onAbort);
    db.finish(id, {
      status,
      httpStatus,
      errorCode,
      response,
      usage,
      outputText,
      durationMs: Date.now() - started,
    });
    finished = true;
  };
  const record = (bytes: Uint8Array) => {
    bytesReceived += bytes.byteLength;
    if (bytesReceived > 32 * 1024 * 1024)
      throw new GatewayError('RESPONSE_TOO_LARGE', 502, '上游响应过大');
    db.chunk(id, seq++, bytes);
  };
  try {
    const response = await fetcher(upstream.url, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${upstream.key}` },
      body: JSON.stringify(upstreamBody),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const status = response.status === 429 ? 429 : 502;
      finish('failed', status, `UPSTREAM_HTTP_${response.status}`);
      return Response.json(
        {
          error: {
            message: '上游请求失败，请稍后重试',
            type: 'upstream_error',
            code: `UPSTREAM_HTTP_${response.status}`,
          },
        },
        {
          status,
          headers: { 'x-request-id': id, ...(status === 429 ? { 'retry-after': '60' } : {}) },
        },
      );
    }
    if (!response.body) throw new GatewayError('UPSTREAM_EMPTY', 502, '上游返回为空');
    const reader = response.body.getReader();
    upstreamReader = reader;
    if (!body.stream) {
      const parts: Uint8Array[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        record(value);
        parts.push(value);
      }
      const raw = Buffer.concat(parts).toString('utf8');
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new GatewayError('UPSTREAM_INVALID_JSON', 502, '上游响应格式错误');
      }
      if (!Array.isArray(parsed.choices) || parsed.error)
        throw new GatewayError('UPSTREAM_INVALID_RESPONSE', 502, '上游响应格式错误');
      finish(
        'succeeded',
        200,
        undefined,
        raw,
        parsed.usage,
        typeof parsed.choices[0]?.message?.content === 'string'
          ? parsed.choices[0].message.content
          : '',
      );
      return new Response(JSON.stringify({ ...parsed, model: publicModel }), {
        status: 200,
        headers: {
          'content-type': 'application/json',
          'x-request-id': id,
          'cache-control': 'no-store',
        },
      });
    }
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      await reader.cancel();
      throw new GatewayError('UPSTREAM_INVALID_STREAM', 502, '上游没有返回 SSE');
    }
    const stream = new ReadableStream<Uint8Array>({
      start(out) {
        outputController = out;
      },
      async pull(out) {
        try {
          // A network chunk may not contain a complete event. Keep reading until
          // there is output; returning without enqueueing can stall a pending read.
          for (;;) {
            const { value, done } = await reader.read();
            if (done) {
              const tail = publicStream.flush();
              if (tail.byteLength) out.enqueue(tail);
              const success = observer.done && !observer.error;
              finish(
                success ? 'succeeded' : 'interrupted',
                200,
                success
                  ? undefined
                  : observer.error
                    ? 'UPSTREAM_STREAM_ERROR'
                    : 'UPSTREAM_TRUNCATED',
              );
              out.close();
              return;
            }
            record(value);
            observer.feed(value);
            const visible = publicStream.feed(value);
            if (visible.byteLength) out.enqueue(visible);
            if (observer.done) {
              finish(
                observer.error ? 'failed' : 'succeeded',
                200,
                observer.error ? 'UPSTREAM_STREAM_ERROR' : undefined,
              );
              out.close();
              await reader.cancel();
              return;
            }
            if (visible.byteLength) return;
          }
        } catch (e) {
          controller.abort();
          finish(
            clientClosed ? 'interrupted' : 'failed',
            200,
            clientClosed
              ? 'CLIENT_DISCONNECTED'
              : timedOut
                ? 'UPSTREAM_TIMEOUT'
                : e instanceof GatewayError
                  ? e.code
                  : 'STREAM_FAILED',
          );
          out.error(new Error('API stream interrupted'));
        }
      },
      async cancel() {
        clientClosed = true;
        controller.abort();
        try {
          await reader.cancel();
        } finally {
          finish('interrupted', 200, 'CLIENT_DISCONNECTED');
        }
      },
    });
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-store',
        'x-accel-buffering': 'no',
        'x-request-id': id,
      },
    });
  } catch (e) {
    controller.abort();
    const err =
      e instanceof GatewayError
        ? e
        : new GatewayError(
            timedOut
              ? 'UPSTREAM_TIMEOUT'
              : clientClosed
                ? 'CLIENT_DISCONNECTED'
                : 'UPSTREAM_FAILED',
            timedOut ? 504 : 502,
            '上游调用未完成',
          );
    finish(clientClosed ? 'interrupted' : 'failed', err.status, err.code);
    return Response.json(
      { error: { code: err.code, type: 'api_error', message: err.message } },
      { status: err.status, headers: { 'x-request-id': id } },
    );
  }
}
