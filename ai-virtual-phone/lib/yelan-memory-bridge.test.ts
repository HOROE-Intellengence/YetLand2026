import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  request: vi.fn(), values: new Map<string, string>(),
  timelines: new Map<string, Array<{ id: string; sourceApp: string; content: string; timestamp: string }>>(),
  dwelling: vi.fn(),
  automatic: true, allowed: undefined as string[] | undefined,
}));
vi.mock('./yelan-managed-client', () => ({ isYelanManaged: true, yelanRequest: fixtures.request }));
vi.mock('./character-storage', () => ({ loadCharacters: () => [{ id: 'a' }, { id: 'b' }] }));
vi.mock('./short-term-assembler', () => ({ loadNativeTimeline: (id: string) => fixtures.timelines.get(id) || [], filterTimelineByAllowedSources: (entries: any[], allowed?: string[]) => allowed ? entries.filter(entry => allowed.includes(entry.sourceApp)) : entries }));
vi.mock('./memory-storage', () => ({ loadMemoryConfig: () => ({ autoSummarizeEnabled: fixtures.automatic, shortTermAllowedSources: fixtures.allowed }) }));
vi.mock('./kv-db', () => ({ kvGet: (key: string) => fixtures.values.get(key), kvSet: (key: string, value: string) => fixtures.values.set(key, value) }));
vi.mock('./dwelling-storage', () => ({ loadDwellingLayout: fixtures.dwelling }));
import { flushYelanMemory } from './yelan-memory-bridge';

describe('phone memory upload acknowledgement', () => {
  beforeEach(() => { fixtures.values.clear(); fixtures.timelines.clear(); fixtures.request.mockReset(); fixtures.dwelling.mockReset().mockResolvedValue(null); fixtures.automatic = true; fixtures.allowed = undefined; });
  it('respects user automatic-memory and source choices, while allowing manual recording', async () => {
    fixtures.timelines.set('a', [{ id: 'chat', sourceApp: 'chat', timestamp: 'today', content: '聊天事件' }, { id: 'story', sourceApp: 'story', timestamp: 'today', content: '故事事件' }]);
    fixtures.automatic = false; fixtures.allowed = ['chat']; fixtures.request.mockResolvedValue({ ok: true });
    await flushYelanMemory(true); expect(fixtures.request).not.toHaveBeenCalled();
    await flushYelanMemory(); expect(fixtures.request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fixtures.request.mock.calls[0][1].body).text).toContain('聊天事件');
    expect(JSON.parse(fixtures.request.mock.calls[0][1].body).text).not.toContain('故事事件');
  });
  it('uploads saved fictional dwelling text only for its owner role and reuses acknowledgements', async () => {
    fixtures.dwelling.mockImplementation(async id => id === 'a' ? { updatedAt: '2026-10-07', layout: { rooms: [{
      id: 'room', name: '书房', description: '蓝色窗帘', imageAssetId: 'private-image-reference',
      furniture: [{ id: 'desk', label: '书桌', items: [{ id: 'bell', name: '风铃', preview: '<script>private HTML</script>' }] }],
    }] } } : null);
    fixtures.request.mockResolvedValue({ ok: true });
    await flushYelanMemory();
    expect(fixtures.request).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fixtures.request.mock.calls[0][1].body);
    expect(body).toMatchObject({ characterId: 'a', sourceApp: 'dwelling', mode: 'main' });
    expect(body.text).toContain('不是现实用户的住址');
    expect(body.text).toContain('书房');
    expect(body.text).toContain('风铃');
    expect(body.text).not.toContain('private-image-reference');
    expect(body.text).not.toContain('<script>');
    fixtures.request.mockClear();
    await flushYelanMemory();
    expect(fixtures.request).not.toHaveBeenCalled();
  });
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
