// events 路由单测 — 埋点回收、批量写入
import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { clearPolicyCache } from '../services/policy';
import { mockEventsRoute } from '../routes/events';

describe('POST /api/events', () => {
  beforeEach(() => {
    store.__resetForTests();
    clearPolicyCache();
  });

  it('returns 400 VALIDATION_ERROR on empty body', async () => {
    const res = await mockEventsRoute.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });

  it('returns 200 for a single event', async () => {
    const res = await mockEventsRoute.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [{ name: 'app_open', ts: Date.now() }],
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { accepted: boolean; count: number };
    expect(body.accepted).toBe(true);
    expect(body.count).toBe(1);
  });

  it('returns 200 with correct count for batch of 5', async () => {
    const events = Array.from({ length: 5 }, (_, i) => ({
      name: `event_${i}`,
      ts: Date.now() + i,
    }));
    const res = await mockEventsRoute.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { accepted: boolean; count: number };
    expect(body.accepted).toBe(true);
    expect(body.count).toBe(5);
  });

  it('returns 200 for empty events array', async () => {
    const res = await mockEventsRoute.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { accepted: boolean; count: number };
    expect(body.accepted).toBe(true);
    expect(body.count).toBe(0);
  });

  it('stores event in conversationLogs', async () => {
    const res = await mockEventsRoute.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [{ name: 'user_feedback', ts: Date.now() }],
      }),
    });
    expect(res.status).toBe(200);

    const logs = store.state().conversationLogs;
    expect(logs).toHaveLength(1);
    const payload = logs[0]!.payload as { events: Array<{ name: string }> };
    expect(payload.events[0]!.name).toBe('user_feedback');
  });

  it('preserves event payload in store', async () => {
    const payload = { score: 5, comment: 'great' };
    const res = await mockEventsRoute.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [{ name: 'rating', ts: Date.now(), payload }],
      }),
    });
    expect(res.status).toBe(200);

    const logs = store.state().conversationLogs;
    expect(logs).toHaveLength(1);
    const storedPayload = logs[0]!.payload as {
      events: Array<{ name: string; payload?: Record<string, unknown> }>;
    };
    expect(storedPayload.events[0]!.payload).toEqual(payload);
  });

  it('organizes user feedback text into user events', async () => {
    const res = await mockEventsRoute.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: [
          {
            name: 'user_feedback',
            ts: Date.UTC(2026, 4, 18),
            payload: { text: '希望记忆面板更清楚', characterId: 'char_luna', mode: 'main' },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const events = Object.values(store.state().userEvents);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      userId: 'anonymous',
      characterId: 'char_luna',
      mode: 'main',
      date: '2026-05-18',
      text: '用户反馈：希望记忆面板更清楚',
      emotion: 'feedback',
      tombstone: false,
    });
  });

  it('returns 400 for invalid event shape', async () => {
    const res = await mockEventsRoute.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ events: [{ bad_field: true }] }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as { code?: string };
    expect(body.code).toBe('VALIDATION_ERROR');
  });
});
