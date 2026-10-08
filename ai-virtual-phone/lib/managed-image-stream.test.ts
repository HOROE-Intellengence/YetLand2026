import {afterEach, describe, expect, it, vi} from 'vitest';
import {streamManagedImageJson} from './managed-image-stream';
import {yelanRequest} from './yelan-managed-client';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('managed image transport', () => {
  it('sends heartbeats before the image response and keeps base64 intact', async () => {
    vi.useFakeTimers();
    let finish!: (response: Response) => void;
    const forward = vi.fn(() => new Promise<Response>(resolve => { finish = resolve; }));
    const response = streamManagedImageJson(forward, new AbortController().signal, 1000);
    const reader = response.body!.getReader();
    const chunks = [(await reader.read()).value!];
    await vi.advanceTimersByTimeAsync(3000);
    for (let i = 0; i < 3; i++) chunks.push((await reader.read()).value!);
    finish(Response.json({ b64: 'abcDEF123==', mimeType: 'image/png' }));
    while (true) { const chunk = await reader.read(); if (chunk.done) break; chunks.push(chunk.value); }
    const text = chunks.map(chunk => new TextDecoder().decode(chunk)).join('');
    expect(text).toMatch(/^ {4}\{/);
    expect(JSON.parse(text).b64).toBe('abcDEF123==');
    expect(forward).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });
  it.each([401,403,429,502])('preserves backend error %i for the client', async status => {
    const response = streamManagedImageJson(async () => Response.json({code:'FAILED'}, {status}), new AbortController().signal);
    expect(await response.json()).toEqual({code:'FAILED', __yelan_http_status:status});
  });
  it('aborts an in-flight operation when the client cancels', async () => {
    let active!: AbortSignal;
    const forward = vi.fn((signal: AbortSignal) => { active = signal; return new Promise<Response>(() => {}); });
    const response = streamManagedImageJson(forward, new AbortController().signal);
    await response.body!.cancel();
    expect(active.aborted).toBe(true);
    expect(forward).toHaveBeenCalledTimes(1);
  });
  it('maps transport failure to a JSON error without retrying', async () => {
    const forward = vi.fn(async () => { throw Error('network'); });
    const response = streamManagedImageJson(forward, new AbortController().signal);
    expect(await response.json()).toEqual({code:'YELAN_UNAVAILABLE', __yelan_http_status:502});
    expect(forward).toHaveBeenCalledTimes(1);
  });
  it.each([[401,'请返回夜阑重新登录'],[429,'夜阑服务暂不可用']])('rejects streamed HTTP %i instead of accepting HTTP 200', async (status, message) => {
    vi.stubGlobal('fetch', vi.fn(async () => streamManagedImageJson(async () => Response.json({code:'FAILED'},{status:Number(status)}), new AbortController().signal)));
    await expect(yelanRequest('/phone/images/generations')).rejects.toThrow(String(message));
  });
});
