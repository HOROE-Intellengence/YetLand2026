import { setTimeout as delay } from 'node:timers/promises';
import { readImageResponse } from './image-download';

export async function waitForImageTask(initial: Record<string, unknown>, base: URL, key: string, signal: AbortSignal, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  let current = initial;
  if (current.object !== 'image.task') return current;
  const raw = current.poll_url || current.result_url;
  if (typeof raw !== 'string') throw new Error('IMAGE_TASK_MISSING_URL');
  const url = new URL(raw, base);
  const taskPrefix = base.pathname.replace(/\/$/, '') + '/images/tasks/';
  if (url.origin !== base.origin || url.username || url.password || !url.pathname.startsWith(taskPrefix)) throw new Error('IMAGE_TASK_URL_REJECTED');
  while (true) {
    signal.throwIfAborted();
    if (current.object !== 'image.task' && (imageResultSource(current).b64 || imageResultSource(current).url)) return current;
    if (['failed', 'cancelled', 'canceled', 'expired'].includes(String(current.status))) throw new Error('IMAGE_TASK_FAILED');
    if (['succeeded', 'completed', 'success'].includes(String(current.status))) {
      // Some task responses wrap the normal images payload in result.
      return current.result && typeof current.result === 'object' ? current.result as Record<string, unknown> : current;
    }
    if (!['queued', 'pending', 'processing', 'running', 'in_progress'].includes(String(current.status))) throw new Error('IMAGE_TASK_UNKNOWN_STATUS');
    await delay(Math.min(10000, Math.max(2000, Number(current.poll_after_ms) || 2000)), undefined, { signal });
    const response = await fetcher(url, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal });
    current = JSON.parse((await readImageResponse(response)).toString('utf8')) as Record<string, unknown>;
  }
}

export function imageResultSource(result: Record<string, unknown>): { b64?: string; url?: string } {
  for (const field of ['data', 'assets', 'images']) {
    const rows = result[field];
    if (!Array.isArray(rows)) continue;
    for (const item of rows) {
      if (!item || typeof item !== 'object') continue;
      if (typeof item.b64_json === 'string' && item.b64_json) return { b64: item.b64_json };
      if (typeof item.url === 'string' && item.url) return { url: item.url };
    }
  }
  return {};
}
