import { afterEach, describe, expect, it, vi } from 'vitest';
import { createOpenAILikeProvider } from '../providers/openai';

// 构造一个最小 SSE 流响应：一条 content delta + [DONE]
function sseResponse(text: string): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const enc = new TextEncoder();
      controller.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n`));
      controller.enqueue(enc.encode('data: [DONE]\n'));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function captureFetch() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    return sseResponse('ok');
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

const apiKey = 'sk-test-key-1234567890';

async function drain(provider: ReturnType<typeof createOpenAILikeProvider>, req: Parameters<typeof provider.stream>[0]) {
  for await (const _ of provider.stream(req)) { /* drain */ }
}

describe('createOpenAILikeProvider reasoning_effort', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('不传 reasoningEffort 时 body 里没有 reasoning_effort（保持原样）', async () => {
    const calls = captureFetch();
    const p = createOpenAILikeProvider({ apiKey, defaultModel: 'gemini-3.1-flash-lite' });
    await drain(p, { model: 'gemini-3.1-flash-lite', messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0].body).not.toHaveProperty('reasoning_effort');
  });

  it('支持的模型族 + 显式 reasoningEffort 时写入 reasoning_effort', async () => {
    const calls = captureFetch();
    const p = createOpenAILikeProvider({ apiKey, defaultModel: 'gemini-3.1-flash-lite' });
    await drain(p, { model: 'gemini-3.1-flash-lite', messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'low' });
    expect(calls[0].body.reasoning_effort).toBe('low');
  });

  it('不支持的模型（deepseek-chat / gpt-4o-mini）即便显式传也不写入（守卫）', async () => {
    const calls = captureFetch();
    const p = createOpenAILikeProvider({ apiKey, defaultModel: 'deepseek-chat' });
    await drain(p, { model: 'deepseek-chat', messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'high' });
    await drain(p, { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'high' });
    expect(calls[0].body).not.toHaveProperty('reasoning_effort');
    expect(calls[1].body).not.toHaveProperty('reasoning_effort');
  });

  it('OpenAI 推理族（gpt-5 / o 系列）也会写入', async () => {
    const calls = captureFetch();
    const p = createOpenAILikeProvider({ apiKey });
    await drain(p, { model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'medium' });
    await drain(p, { model: 'o3-mini', messages: [{ role: 'user', content: 'hi' }], reasoningEffort: 'minimal' });
    expect(calls[0].body.reasoning_effort).toBe('medium');
    expect(calls[1].body.reasoning_effort).toBe('minimal');
  });
});

describe('createOpenAILikeProvider baseUrl 归一', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('baseUrl 为 API 根时正常拼出 /chat/completions', async () => {
    const calls = captureFetch();
    const p = createOpenAILikeProvider({ apiKey, baseUrl: 'https://horoe.cn/v1' });
    await drain(p, { model: 'gemini-3.1-flash-lite', messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0].url).toBe('https://horoe.cn/v1/chat/completions');
  });

  it('后台误粘贴了完整 .../chat/completions 时去重，不拼成双段', async () => {
    const calls = captureFetch();
    const p = createOpenAILikeProvider({ apiKey, baseUrl: 'https://horoe.cn/v1/chat/completions' });
    await drain(p, { model: 'gemini-3.1-flash-lite', messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0].url).toBe('https://horoe.cn/v1/chat/completions');
    expect(calls[0].url).not.toContain('/chat/completions/chat/completions');
  });

  it('带尾随斜杠的完整 URL 也能去重', async () => {
    const calls = captureFetch();
    const p = createOpenAILikeProvider({ apiKey, baseUrl: 'https://horoe.cn/v1/chat/completions/' });
    await drain(p, { model: 'gemini-3.1-flash-lite', messages: [{ role: 'user', content: 'hi' }] });
    expect(calls[0].url).toBe('https://horoe.cn/v1/chat/completions');
  });
});
