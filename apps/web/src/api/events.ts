import type { TelemetryEvent } from '@yelan/shared';
import { api } from './client';

const queue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

export function track(event: TelemetryEvent) {
  queue.push(event);
  if (!flushTimer) flushTimer = setTimeout(flush, 1500);
}

export async function trackNow(event: TelemetryEvent) {
  queue.push(event);
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flush(true);
}

async function flush(throwOnError = false) {
  flushTimer = null;
  if (queue.length === 0) return;
  const batch = queue.splice(0);
  try {
    await api('/api/events', { method: 'POST', body: JSON.stringify({ events: batch }) });
  } catch (error) {
    queue.unshift(...batch);
    if (throwOnError) throw error;
  }
}
