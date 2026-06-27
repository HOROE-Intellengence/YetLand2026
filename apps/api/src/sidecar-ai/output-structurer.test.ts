import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../store/persistence';
import { normalizeStructurerParts, coerceStructurerParts, fallbackStructure, structureOutput } from './output-structurer';

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

describe('normalizeStructurerParts', () => {
  it('wraps array input into { parts: [...] }', () => {
    const input = [
      { type: 'dialogue', text: '你好' },
      { type: 'action', text: '挥了挥手' },
    ];
    const result = normalizeStructurerParts(input);
    expect(result).toEqual({ parts: input });
    expect(result.parts).toHaveLength(2);
  });

  it('passes through object with parts array unchanged', () => {
    const input = {
      parts: [
        { type: 'dialogue', text: '台词' },
        { type: 'narration', text: '旁白' },
      ],
    };
    const result = normalizeStructurerParts(input);
    expect(result).toEqual({ parts: input.parts });
    expect(result.parts).toHaveLength(2);
  });

  it('returns empty parts for null input', () => {
    expect(normalizeStructurerParts(null)).toEqual({ parts: [] });
  });

  it('returns empty parts for string input', () => {
    expect(normalizeStructurerParts('some string')).toEqual({ parts: [] });
  });

  it('returns empty parts for plain object without parts array', () => {
    expect(normalizeStructurerParts({})).toEqual({ parts: [] });
  });

  it('returns empty parts for object with non-array parts', () => {
    expect(normalizeStructurerParts({ parts: 'not-an-array' })).toEqual({ parts: [] });
  });

  it('returns empty parts for undefined input', () => {
    expect(normalizeStructurerParts(undefined)).toEqual({ parts: [] });
  });

  it('returns empty parts for number input', () => {
    expect(normalizeStructurerParts(42)).toEqual({ parts: [] });
  });
});

describe('coerceStructurerParts', () => {
  it('keeps valid parts unchanged', () => {
    const result = coerceStructurerParts([
      { type: 'dialogue', text: '你好' },
      { type: 'action', text: '挥手' },
    ]);
    expect(result).toEqual([
      { type: 'dialogue', text: '你好' },
      { type: 'action', text: '挥手' },
    ]);
  });

  it('coerces unknown type to narration instead of dropping the part', () => {
    const result = coerceStructurerParts([
      { type: 'speech', text: '没忘。' },
      { type: 'dialogue', text: '坐。' },
    ]);
    expect(result).toEqual([
      { type: 'narration', text: '没忘。' },
      { type: 'dialogue', text: '坐。' },
    ]);
  });

  it('drops parts without usable text but keeps the rest', () => {
    const result = coerceStructurerParts([
      { type: 'dialogue', text: '' },
      { type: 'action' },
      { type: 'dialogue', text: '别多想。' },
      null,
      'garbage',
    ]);
    expect(result).toEqual([{ type: 'dialogue', text: '别多想。' }]);
  });

  it('keeps a cross-line quoted line as a single dialogue part', () => {
    const result = coerceStructurerParts([
      { type: 'action', text: '他停下脚步，低声说：' },
      { type: 'dialogue', text: '「我等了你很久，\n久到自己都快不信你会来。」' },
    ]);
    expect(result).toEqual([
      { type: 'action', text: '他停下脚步，低声说：' },
      { type: 'dialogue', text: '「我等了你很久，\n久到自己都快不信你会来。」' },
    ]);
  });
});

describe('fallbackStructure', () => {
  it('splits text into sentences, all typed as narration', () => {
    const result = fallbackStructure('句子一。句子二。');
    expect(result.parts).toHaveLength(2);
    expect(result.parts[0]).toEqual({ type: 'narration', text: '句子一。' });
    expect(result.parts[1]).toEqual({ type: 'narration', text: '句子二。' });
  });

  it('returns empty parts for empty string', () => {
    const result = fallbackStructure('');
    expect(result.parts).toEqual([]);
  });

  it('returns empty parts for whitespace-only string', () => {
    const result = fallbackStructure('   ');
    expect(result.parts).toEqual([]);
  });

  it('handles single sentence', () => {
    const result = fallbackStructure('只有一句话。');
    expect(result.parts).toHaveLength(1);
    expect(result.parts[0]!.type).toBe('narration');
  });
});

describe('structureOutput timeout budget', () => {
  beforeEach(() => {
    store.__resetForTests();
    seedSidecarApi();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('allows a 2s sidecar response to return structured non-narration parts', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      setTimeout(() => {
        resolve(new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                parts: [
                  { type: 'dialogue', text: '你好。' },
                  { type: 'action', text: '他抬起眼。' },
                ],
              }),
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }, 2000);
    })));

    const pending = structureOutput('“你好。”他抬起眼。');

    await vi.advanceTimersByTimeAsync(2000);

    await expect(pending).resolves.toEqual({
      ok: true,
      data: {
        parts: [
          { type: 'dialogue', text: '你好。' },
          { type: 'action', text: '他抬起眼。' },
        ],
      },
    });
  });
});
