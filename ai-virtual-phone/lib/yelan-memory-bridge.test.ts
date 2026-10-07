import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  request: vi.fn(), values: new Map<string, string>(),
  timelines: new Map<string, Array<{ id: string; sourceApp: string; content: string; timestamp: string }>>(),
}));
vi.mock('./yelan-managed-client', () => ({ isYelanManaged: true, yelanRequest: fixtures.request }));
vi.mock('./character-storage', () => ({ loadCharacters: () => [{ id: 'a' }, { id: 'b' }] }));
vi.mock('./short-term-assembler', () => ({ loadNativeTimeline: (id: string) => fixtures.timelines.get(id) || [] }));
vi.mock('./kv-db', () => ({ kvGet: (key: string) => fixtures.values.get(key), kvSet: (key: string, value: string) => fixtures.values.set(key, value) }));
import { flushYelanMemory } from './yelan-memory-bridge';

describe('phone memory upload acknowledgement', () => {
  beforeEach(() => { fixtures.values.clear(); fixtures.timelines.clear(); fixtures.request.mockReset(); });
  it('retries only an unacknowledged part and continues another role after failure', async () => {
    fixtures.timelines.set('a', [{ id: 'long', sourceApp: 'chat', timestamp: 'today', content: '甲'.repeat(7000) }]);
    fixtures.timelines.set('b', [{ id: 'other', sourceApp: 'diary', timestamp: 'today', content: '另一角色的资料' }]);
    fixtures.request.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('offline')).mockResolvedValue({ ok: true });
    await flushYelanMemory();
    expect(JSON.parse(fixtures.values.get('yelan-memory-ack:a')!).some((key: string) => key.startsWith('entry:v2:'))).toBe(false);
    expect(JSON.parse(fixtures.values.get('yelan-memory-ack:b')!).some((key: string) => key.startsWith('entry:v2:'))).toBe(true);
    const failedBody = fixtures.request.mock.calls[1][1].body;
    fixtures.request.mockClear();
    await flushYelanMemory();
    expect(fixtures.request).toHaveBeenCalledTimes(1);
    expect(fixtures.request.mock.calls[0][1].body).toBe(failedBody);
    expect(JSON.parse(fixtures.values.get('yelan-memory-ack:a')!).some((key: string) => key.startsWith('entry:v2:'))).toBe(true);
    fixtures.request.mockClear();
    await flushYelanMemory();
    expect(fixtures.request).not.toHaveBeenCalled();
  });
  it('uploads a changed projection even when its stable record ID was already acknowledged', async () => {
    const entry = { id: 'map_summary_world1', sourceApp: 'map', timestamp: 'today', content: '第一幕' };
    fixtures.timelines.set('a', [entry]);
    fixtures.request.mockResolvedValue({ ok: true });
    await flushYelanMemory();
    const firstEvent = JSON.parse(fixtures.request.mock.calls[0][1].body).eventId;
    entry.content = '第二幕新增经历';
    fixtures.request.mockClear();
    await flushYelanMemory();
    expect(fixtures.request).toHaveBeenCalledTimes(1);
    const nextEvent = JSON.parse(fixtures.request.mock.calls[0][1].body);
    expect(nextEvent.eventId).not.toBe(firstEvent);
    expect(nextEvent.text).toContain('第二幕新增经历');
  });
});
