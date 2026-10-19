import { afterEach, expect, it, vi } from 'vitest';
import type { ApiConfig, RegexConfig } from './settings-types';
import { sendLLMRequest, sendLLMStreamRequest } from './chat-engine';

vi.mock('./api-log-store', () => ({ pushApiLog: vi.fn(), getApiLogs: () => [], clearApiLogs: vi.fn() }));
const config: ApiConfig = { id: 'synthetic', provider: 'custom', apiKey: 'synthetic-key',
  baseUrl: 'https://example.invalid/v1', defaultModel: 'synthetic-model',
  enableImageRecognition: false, enableImageGeneration: false };
const messages = [{ role: 'user' as const, content: 'synthetic input' }];
const erase: RegexConfig = { id: 'erase', name: 'erase', createdAt: 0, updatedAt: 0,
  rules: [{ id: 'erase', scriptName: 'erase', findRegex: '/[\\s\\S]+/g', replaceString: '',
    disabled: false, placement: [2] }] };
afterEach(() => vi.unstubAllGlobals());

it('reports content erased by output rules instead of returning a successful empty reply', async () => {
  const fetcher = vi.fn(async () => Response.json({ choices: [{ message: { content: 'visible reply' } }] }));
  vi.stubGlobal('fetch', fetcher);
  await expect(sendLLMRequest(config, null, messages, [erase])).rejects.toThrow('没有可显示的内容');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('reports erased streaming content after real SSE parsing', async () => {
  const fetcher = vi.fn(async () => new Response('data: {"choices":[{"delta":{"content":"visible reply"}}]}\n\ndata: [DONE]\n\n'));
  vi.stubGlobal('fetch', fetcher);
  await expect(sendLLMStreamRequest(config, null, messages, [erase])).rejects.toThrow('没有可显示的内容');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it('rejects invisible-only provider output', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content: '\u200b\u2060' } }] })));
  await expect(sendLLMRequest(config, null, messages, [])).rejects.toThrow('empty content');
});
it.each(['你好 👨‍👩‍👧', '[照片:紫色纸鹤]', '[静默]'])('preserves visible or intentional protocol output %s', async content => {
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ choices: [{ message: { content } }] })));
  await expect(sendLLMRequest(config, null, messages, [])).resolves.toBe(content);
});
