import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { phoneRoute } from '../routes/phone';

vi.mock('../middleware/auth', () => ({ requireAuth: () => async (c: any, next: () => Promise<void>) => {
  if (c.req.header('authorization') !== 'Bearer test-user') return c.json({ code: 'AUTH_REQUIRED' }, 401);
  c.set('userId', 'u1'); await next();
} }));
vi.mock('../services/characters', () => ({ charactersService: {
  get: (id: string) => ({ id, isActive: true }),
  canAccess: (id: string) => id === 'public',
  listVisibleTo: () => [{ id: 'public', name: '可见角色', isActive: true }],
} }));
vi.mock('../prompts/loader', () => ({ loadCharacterCard: () => '服务端角色设定', loadPreludeCard: () => '服务端前置卡' }));
vi.mock('../services/llm-api-inventory', () => ({ getLlmApiConfig: () => ({
  model: 'managed-model', protocol: 'openai-compatible', baseUrl: 'https://upstream.test/v1', apiKey: 'server-only-test-key',
}) }));
vi.mock('./memory', async importOriginal => {
  const original = await importOriginal<typeof import('./memory')>();
  return { ...original, readPhoneMemory: () => '共享记忆' };
});

const app = new Hono().route('/api/phone', phoneRoute);
describe('phone managed routes', () => {
  beforeEach(() => { vi.unstubAllGlobals(); });
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
});
