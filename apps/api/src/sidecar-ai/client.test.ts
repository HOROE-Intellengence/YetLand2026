import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../store/persistence';
import { sidecarCall, extractSidecarJson } from './client';

/** mock fetch：让 /chat/completions 返回指定的 message.content 字符串 */
function stubContent(content: string) {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve(new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )),
  ));
}

function seedSidecarApi() {
  const now = new Date().toISOString();
  store.state().llmApiInventory = {
    entries: {
      sidecar: {
        id: 'sidecar',
        name: 'Sidecar',
        protocol: 'openai-compatible',
        baseUrl: 'https://example.test/v1',
        model: 'test-model',
        apiKey: 'sidecar-key-1234567890',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    },
    mainApiId: null,
    sidecarApiId: 'sidecar',
    sidecarTaskApiIds: {},
  };
}

describe('sidecarCall', () => {
  beforeEach(() => {
    store.__resetForTests();
    seedSidecarApi();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('keeps the timeout active while reading the response body', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init?: RequestInit) => {
      const signal = init?.signal;
      const body = new ReadableStream({
        start(controller) {
          signal?.addEventListener('abort', () => controller.error(new DOMException('Aborted', 'AbortError')));
        },
      });
      return Promise.resolve(new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    }));

    await expect(sidecarCall('system', 'user', { timeoutMs: 1 })).resolves.toEqual({
      ok: false,
      error: 'sidecar timeout after 1ms',
    });
  });

  it('parses bare JSON object', async () => {
    stubContent('{"parts":[{"type":"dialogue","text":"嗨"}]}');
    const r = await sidecarCall<{ parts: unknown[] }>('s', 'u');
    expect(r.ok).toBe(true);
    expect((r as { data: { parts: unknown[] } }).data.parts).toHaveLength(1);
  });

  it('parses markdown-fenced JSON (```json … ```)', async () => {
    stubContent('```json\n{"parts":[{"type":"action","text":"她转身"}]}\n```');
    const r = await sidecarCall<{ parts: { type: string }[] }>('s', 'u');
    expect(r.ok).toBe(true);
    expect((r as { data: { parts: { type: string }[] } }).data.parts[0]?.type).toBe('action');
  });

  it('parses JSON wrapped in <think> prefix and surrounding prose', async () => {
    stubContent('<think>先分析一下…</think>\n好的，结果是：\n{"parts":[{"type":"environment","text":"夜色"}]}\n以上。');
    const r = await sidecarCall<{ parts: { type: string }[] }>('s', 'u');
    expect(r.ok).toBe(true);
    expect((r as { data: { parts: { type: string }[] } }).data.parts[0]?.type).toBe('environment');
  });

  it('extractSidecarJson leaves clean JSON untouched and strips wrappers', () => {
    expect(extractSidecarJson('{"a":1}')).toBe('{"a":1}');
    expect(extractSidecarJson('```\n[1,2]\n```')).toBe('[1,2]');
    expect(extractSidecarJson('<think>x</think>{"a":1}')).toBe('{"a":1}');
  });
});
