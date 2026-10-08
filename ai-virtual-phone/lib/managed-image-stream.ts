/** JSON whitespace keeps the CDN and overseas proxy alive while the API generates an image.
 * Headers are sent early, so errors carry their original status inside the JSON body.
 */
export function streamManagedImageJson(
  forward: (signal: AbortSignal) => Promise<Response>,
  clientSignal: AbortSignal,
  heartbeatMs = 15_000,
): Response {
  const abort = new AbortController();
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  const stop = () => { if (timer) clearInterval(timer); timer = undefined; };
  const onAbort = () => { closed = true; stop(); abort.abort(); };
  clientSignal.addEventListener('abort', onAbort, { once: true });
  if (clientSignal.aborted) onAbort();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      if (closed) { controller.close(); return; }
      controller.enqueue(encoder.encode(' '));
      timer = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(' '));
      }, heartbeatMs);
      try {
        const response = await forward(abort.signal);
        stop(); // Never insert whitespace inside a JSON string or base64 image.
        if (closed) return;
        if (!response.ok) {
          const data = await response.json().catch(() => ({ code: 'YELAN_UNAVAILABLE' }));
          if (!closed) controller.enqueue(encoder.encode(JSON.stringify({
            ...(data && typeof data === 'object' && !Array.isArray(data) ? data : { code: 'YELAN_UNAVAILABLE' }),
            __yelan_http_status: response.status,
          })));
        } else if (response.body) {
          const reader = response.body.getReader();
          try {
            while (!closed) {
              const chunk = await reader.read();
              if (chunk.done) break;
              controller.enqueue(chunk.value);
            }
          } finally { if (closed) await reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        if (!closed) controller.close();
      } catch {
        if (!closed) {
          // An incomplete successful body must fail parsing, never appear successful.
          controller.enqueue(encoder.encode(JSON.stringify({ code: 'YELAN_UNAVAILABLE', __yelan_http_status: 502 })));
          controller.close();
        }
      } finally {
        stop();
        clientSignal.removeEventListener('abort', onAbort);
      }
    },
    cancel() { onAbort(); clientSignal.removeEventListener('abort', onAbort); },
  });
  return new Response(body, { headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'private, no-store',
    'X-Yelan-Streaming-JSON': '1',
  } });
}
