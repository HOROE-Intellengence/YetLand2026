import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from './index';

const env = { GOOGLE_API_KEY: 'test-key', RELAY_TOKEN: 'test-token-000000000000000000000000' };
function request(path = '/google-live', token = env.RELAY_TOKEN) {
  return new Request(`https://relay.example${path}`, { headers: { Upgrade: 'websocket', Authorization: `Bearer ${token}` } });
}
afterEach(() => vi.unstubAllGlobals());
describe('Google-only WebSocket relay', () => {
  it('rejects unauthenticated and arbitrary targets before fetch', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await worker.fetch(request('/google-live', 'wrong'), env)).status).toBe(401);
    expect((await worker.fetch(request('/google-api/arbitrary'), env)).status).toBe(404);
    expect((await worker.fetch(request('/google-live?key=attacker'), env)).status).toBe(404);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires websocket upgrade', async () => {
    expect((await worker.fetch(new Request('https://relay.example/google-live', { headers: { Authorization: `Bearer ${env.RELAY_TOKEN}` } }), env)).status).toBe(426);
  });
  it('passes through the upgraded response and never forwards the relay token', async () => {
    const upgraded = { status: 101, webSocket: {} };
    const fetch = vi.fn().mockResolvedValue(upgraded); vi.stubGlobal('fetch', fetch);
    expect(await worker.fetch(request(), env)).toBe(upgraded);
    expect(fetch.mock.calls[0]![0]).toBe('https://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=test-key');
    expect(fetch.mock.calls[0]![1]).toEqual({ headers: { Upgrade: 'websocket' }, redirect: 'manual' });
  });
  it('redacts upstream errors and does not follow redirects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret', { status: 302 })));
    const result = await worker.fetch(request(), env);
    expect(result.status).toBe(502); expect(await result.text()).toBe('Upstream rejected');
  });
});
