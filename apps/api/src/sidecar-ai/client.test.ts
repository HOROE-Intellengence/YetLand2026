import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../store/persistence';
import { sidecarCall, extractSidecarJson, repairLatexBackslashes } from './client';

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

  it('recovers under-escaped LaTeX in structured output (\\frac → 不被解成换页符)', async () => {
    // 模型把公式里的 \frac 写成单反斜杠 → JSON 里恰是合法的 \f(换页) → 不修复就腐化成乱码。
    stubContent('{"parts":[{"type":"dialogue","text":"答案。$F = G \\frac{m_1 m_2}{r^2}$。"}]}');
    const r = await sidecarCall<{ parts: { text: string }[] }>('s', 'u');
    expect(r.ok).toBe(true);
    const text = (r as { data: { parts: { text: string }[] } }).data.parts[0]!.text;
    expect(text).toContain('\\frac'); // 反斜杠还在
    expect(text).not.toContain('\f'); // 没有换页符
  });
});

describe('repairLatexBackslashes', () => {
  // 辅助：跑 repair 再 JSON.parse，返回还原出的字符串
  const roundTrip = (raw: string): string => JSON.parse(repairLatexBackslashes(raw)).t;

  it('数学区内裸反斜杠命令被翻倍（\\frac \\times \\neq）', () => {
    expect(roundTrip('{"t":"$F=G\\frac{a}{b}$"}')).toBe('$F=G\\frac{a}{b}$');
    expect(roundTrip('{"t":"$a\\times\\beta$"}')).toBe('$a\\times\\beta$');
    expect(roundTrip('{"t":"$x\\neq y$"}')).toBe('$x\\neq y$');
  });

  it('块级公式 $$...$$ 同样修复', () => {
    expect(roundTrip('{"t":"$$\\frac{1}{2}$$"}')).toBe('$$\\frac{1}{2}$$');
  });

  it('已正确转义的 \\\\frac 保持不变（幂等）', () => {
    expect(roundTrip('{"t":"$\\\\frac{a}{b}$"}')).toBe('$\\frac{a}{b}$');
  });

  it('数学区外的真换行 \\n 保留为换行，不当 LaTeX 处理', () => {
    expect(roundTrip('{"t":"第一行\\n第二行"}')).toBe('第一行\n第二行');
    expect(roundTrip('{"t":"看\\n$\\frac{a}{b}$"}')).toBe('看\n$\\frac{a}{b}$');
  });

  it('货币写法（无配对 $）不被误判为公式开端', () => {
    expect(roundTrip('{"t":"要 $5 还是 $10"}')).toBe('要 $5 还是 $10');
  });

  it('合法转义（\\" \\uXXXX）原样保留', () => {
    expect(roundTrip('{"t":"他说 \\"嗨\\""}')).toBe('他说 "嗨"');
    expect(roundTrip('{"t":"\\u00e9"}')).toBe('é');
  });

  it('不含数学区的普通 JSON 是恒等变换', () => {
    const plain = '{"parts":[{"type":"dialogue","text":"嗨"}]}';
    expect(repairLatexBackslashes(plain)).toBe(plain);
  });
});
