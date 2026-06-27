// 埋点回收 — 写到 conversationLogs（mock 简化：合并存）
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { TelemetryBatchSchema } from '@yelan/shared';
import { store } from '../store/persistence';
import { conversationLogRepo } from '../store/repositories';
import { validationHook } from '../middleware/validation';
import { upsertEvents } from '../services/memories';

export const mockEventsRoute = new Hono();

type FeedbackMemoryInput = Parameters<typeof upsertEvents>[1][number];

mockEventsRoute.post(
  '/',
  zValidator('json', TelemetryBatchSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const auth = c.req.header('authorization');
    const token = auth?.startsWith('Bearer ') ? auth.slice(7) : null;
    const userId = token
      ? store.state().tokenIndex[token] ?? 'anonymous'
      : 'anonymous';
    await conversationLogRepo.append({ userId, sessionId: 'telemetry', payload: body, idPrefix: 'tlm' });
    const feedbackEvents = body.events
      .map((event) => toFeedbackMemory(event))
      .filter((event): event is NonNullable<ReturnType<typeof toFeedbackMemory>> => Boolean(event));
    if (feedbackEvents.length > 0) {
      upsertEvents(userId, feedbackEvents);
    }
    store.save();
    return c.json({ accepted: true, count: body.events.length });
  },
);

function toFeedbackMemory(event: {
  name: string;
  ts: number;
  payload?: Record<string, unknown>;
}): FeedbackMemoryInput | null {
  if (event.name !== 'user_feedback') return null;
  const text = typeof event.payload?.text === 'string' ? event.payload.text.trim() : '';
  if (!text) return null;
  const characterId =
    typeof event.payload?.characterId === 'string' && event.payload.characterId.trim()
      ? event.payload.characterId.trim()
      : 'global';
  const mode = event.payload?.mode === 'if' ? 'if' : 'main';
  const date = Number.isFinite(event.ts)
    ? new Date(event.ts).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return {
    characterId,
    mode,
    date,
    text: `用户反馈：${text}`,
    emotion: 'feedback',
  };
}
