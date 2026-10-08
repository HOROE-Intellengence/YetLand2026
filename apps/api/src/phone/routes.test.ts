import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { phoneRoute } from '../routes/phone';
import { readPhoneMemory } from './memory';
const upstream = vi.hoisted(() => ({ baseUrl: 'https://upstream.test/v1' }));
vi.mock('./chat-logs',()=>({phoneChatLogs:()=>({start:vi.fn(),finish:vi.fn()})}));

vi.mock('../middleware/auth', () => ({ requireAuth: () => async (c: any, next: () => Promise<void>) => {
  if (c.req.header('authorization') !== 'Bearer test-user') return c.json({ code: 'AUTH_REQUIRED' }, 401);
  c.set('userId', 'u1'); await next();
} }));
vi.mock('../services/characters', () => ({ charactersService: {
  get: (id: string) => ({ id, isActive: true }),
  canAccess: (id: string) => id === 'public',
  listVisibleTo: () => [{ id: 'public', name: '可见角色', isActive: true }],
  getRow: () => ({ origin: 'admin', visibility: 'public' }),
} }));
vi.mock('../prompts/loader', () => ({ loadCharacterCard: () => '服务端角色设定', loadPreludeCard: () => '服务端前置卡' }));
vi.mock('../services/llm-api-inventory', () => ({ getLlmApiConfig: () => ({
  model: 'managed-model', protocol: 'openai-compatible', baseUrl: upstream.baseUrl, apiKey: 'server-only-test-key',
}) }));
vi.mock('./memory', async importOriginal => {
  const original = await importOriginal<typeof import('./memory')>();
  return { ...original, readPhoneMemory: vi.fn(() => '共享记忆') };
});

const app = new Hono().route('/api/phone', phoneRoute);
describe('phone managed routes', () => {
  beforeEach(() => { vi.unstubAllGlobals(); vi.mocked(readPhoneMemory).mockClear(); upstream.baseUrl = 'https://upstream.test/v1'; });
  it.each(['https://upstream.test/v1', 'https://upstream.test/v1/', 'https://upstream.test/v1/chat/completions', 'https://upstream.test/v1/chat/completions/'])('accepts API roots and complete endpoint URLs: %s', async baseUrl => {
    upstream.baseUrl = baseUrl;
    const fetcher = vi.fn(async () => Response.json({ choices: [] })); vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/phone/characters/public/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer test-user', 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    expect(response.status).toBe(200);
    expect((fetcher.mock.calls[0] as unknown as [string, RequestInit])[0]).toBe('https://upstream.test/v1/chat/completions');
  });
  it('protects image generation and rejects client provider overrides before spending quota', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const path = '/api/phone/images/generations';
    expect((await app.request(path, { method: 'POST', body: '{}' })).status).toBe(401);
    const headers = { Authorization: 'Bearer test-user', 'Content-Type': 'application/json' };
    expect((await app.request(path, { method: 'POST', headers, body: JSON.stringify({ characterId: 'private', prompt: 'test' }) })).status).toBe(404);
    expect((await app.request(path, { method: 'POST', headers, body: JSON.stringify({ prompt: 'test', model: 'client-model', apiKey: 'injected' }) })).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('requires login and returns visible characters without upstream credentials', async () => {
    expect((await app.request('/api/phone/bootstrap')).status).toBe(401);
    const response = await app.request('/api/phone/bootstrap', { headers: { Authorization: 'Bearer test-user' } });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('可见角色');
    expect(text).not.toContain('server-only-test-key');
    expect(text).not.toContain('upstream.test');
  });
  it('denies a private character before contacting the model', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/phone/characters/private/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer test-user', 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
    });
    expect(response.status).toBe(404); expect(fetcher).not.toHaveBeenCalled();
  });
  it('fixes model and credentials server-side and preserves streaming responses', async () => {
    const fetcher = vi.fn(async () => new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    })); vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/phone/characters/public/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer test-user', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'client-model', stream: true, messages: [{ role: 'user', content: '[表情包:开心]' }] }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/event-stream');
    expect(await response.text()).toContain('[DONE]');
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('managed-model');
    expect(body.messages[0].content).toContain('服务端角色设定');
    expect(body.messages[0].content).toContain('共享记忆');
    expect(body.messages[1].content).toBe('[表情包:开心]');
  });
  it('reads the requested branch under the authenticated user and authorized role', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [] })));
    const response = await app.request('/api/phone/characters/public/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer test-user', 'Content-Type': 'application/json',
        'X-Yelan-Memory-Branch': encodeURIComponent('story:支线一') },
      body: JSON.stringify({ messages: [{ role: 'user', content: '继续剧情' }] }),
    });
    expect(response.status).toBe(200);
    expect(readPhoneMemory).toHaveBeenCalledWith('u1', { characterId: 'public', mode: 'main', branchId: 'story:支线一' });
  });
  it.each(['%', 'x'.repeat(129), ''])('rejects malformed branch headers instead of falling back to mainline', async branch => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    const response = await app.request('/api/phone/characters/public/chat/completions', {
      method: 'POST', headers: { Authorization: 'Bearer test-user', 'Content-Type': 'application/json', 'X-Yelan-Memory-Branch': branch },
      body: JSON.stringify({ messages: [{ role: 'user', content: '继续' }] }),
    });
    expect(response.status).toBe(400);
    expect(readPhoneMemory).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
  });
});
