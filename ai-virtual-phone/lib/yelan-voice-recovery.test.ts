import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ values: new Map<string, string>(), request: vi.fn() }));
vi.mock('./kv-db', () => ({ kvGet: (key: string) => mock.values.get(key), kvSetAsync: async (key: string, value: string) => { mock.values.set(key, value); } }));
vi.mock('./yelan-managed-client', () => ({ yelanHeaders: () => ({ Authorization: 'Bearer local-test' }), yelanRequest: mock.request }));
import { clearPendingVoice, loadPendingVoice, recoverVoiceTurn, savePendingVoice, type PendingVoice } from './yelan-voice-recovery';

const turn = { id: 'turn1', sessionId: 'server1', status: 'complete', inputText: '你好', outputText: '晚上好' };
const makeJob = (): PendingVoice => ({ chatSessionId: 'chat1', characterId: 'role1', connection: { id: 'server1', kind: 'voice' }, requestId: 'same-request', input: { text: '你好' } });
describe('phone voice recovery', () => {
  beforeEach(() => { mock.values.clear(); mock.request.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());
  it('reuses persisted input and request ID after a lost POST response, then only queries the accepted turn', async () => {
    const job = makeJob(); await savePendingVoice(job);
    const fetcher = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(Response.json(turn));
    vi.stubGlobal('fetch', fetcher);
    await expect(recoverVoiceTurn(job, new AbortController().signal)).rejects.toThrow('offline');
    const restored = loadPendingVoice('chat1')!;
    await recoverVoiceTurn(restored, new AbortController().signal);
    expect(fetcher.mock.calls[0][1].headers['Idempotency-Key']).toBe(fetcher.mock.calls[1][1].headers['Idempotency-Key']);
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    expect(loadPendingVoice('chat1')?.input).toBeUndefined();
    mock.request.mockResolvedValue(turn);
    await recoverVoiceTurn(loadPendingVoice('chat1')!, new AbortController().signal);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mock.request.mock.calls[0][0]).toBe('/voice/sessions/server1/turns/turn1');
  });
  it('retries an explicitly chosen TTS stage with a stable retry ID across network failures', async () => {
    const job = { ...makeJob(), connection: { id: 'server1', kind: 'voice-hq' as const }, turn,
      retry: { action: 'retry-tts' as const, requestId: 'retry1' } };
    await savePendingVoice(job);
    mock.request.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(turn);
    await expect(recoverVoiceTurn(job, new AbortController().signal)).rejects.toThrow('offline');
    await recoverVoiceTurn(loadPendingVoice('chat1')!, new AbortController().signal);
    expect(mock.request.mock.calls.map(call => call[1].headers['Idempotency-Key'])).toEqual(['retry1', 'retry1']);
    expect(mock.request.mock.calls[1][0]).toContain('/turn1/retry-tts');
    expect(loadPendingVoice('chat1')?.retry).toBeUndefined();
    await clearPendingVoice('chat1');
    expect(loadPendingVoice('chat1')).toBeNull();
  });
});
