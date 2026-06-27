import { describe, expect, it } from 'vitest';
import type { CompletionChunk } from '../types';
import { sanitizeCompletionStream } from '../think-sanitizer';
import type { SanitizerStats } from '../think-sanitizer';

async function collect(chunks: CompletionChunk[]): Promise<CompletionChunk[]> {
  async function* source(): AsyncIterable<CompletionChunk> {
    for (const chunk of chunks) yield chunk;
  }

  const out: CompletionChunk[] = [];
  for await (const chunk of sanitizeCompletionStream(source())) out.push(chunk);
  return out;
}

describe('sanitizeCompletionStream', () => {
  it('removes orphan closing think tags', async () => {
    await expect(collect([{ text: '喝水了吗。</think>' }])).resolves.toEqual([
      { text: '喝水了吗。' },
    ]);
  });

  it('removes think tags split across chunks', async () => {
    await expect(collect([{ text: '喝水了吗。<' }, { text: '/think>' }])).resolves.toEqual([
      { text: '喝水了吗。' },
    ]);
  });

  it('drops full think blocks and keeps visible text', async () => {
    await expect(collect([{ text: '<think>secret</think>正文' }])).resolves.toEqual([
      { text: '正文' },
    ]);
  });

  it('drops think blocks split across multiple chunks', async () => {
    await expect(collect([
      { text: '开头<th' },
      { text: 'ink>secret</thi' },
      { text: 'nk>结尾' },
    ])).resolves.toEqual([
      { text: '开头' },
      { text: '结尾' },
    ]);
  });

  it('preserves usage and finished when the text is fully consumed', async () => {
    await expect(collect([
      { text: '</think>', finished: true, usage: { inputTokens: 3, outputTokens: 5 } },
    ])).resolves.toEqual([
      { text: '', finished: true, usage: { inputTokens: 3, outputTokens: 5 } },
    ]);
  });

  it('flushes a pending non-tag tail on finished chunks', async () => {
    await expect(collect([{ text: 'hello<', finished: true }])).resolves.toEqual([
      { text: 'hello<', finished: true },
    ]);
  });

  it('does not alter ordinary text', async () => {
    await expect(collect([{ text: '2 < 3，普通文本。' }])).resolves.toEqual([
      { text: '2 < 3，普通文本。' },
    ]);
  });

  it('quarantines all text after an unclosed think tag', async () => {
    await expect(collect([{ text: '可见正文。<think>未闭合的思考内容' }])).resolves.toEqual([
      { text: '可见正文。' },
    ]);
  });

  it('drops text after an unclosed think tag split across chunks, keeps finished', async () => {
    await expect(collect([
      { text: '正文<th' },
      { text: 'ink>思考尾巴', finished: true },
    ])).resolves.toEqual([
      { text: '正文' },
      { text: '', finished: true },
    ]);
  });

  it('reports stats when an unclosed think tag swallows the tail', async () => {
    let stats: SanitizerStats | undefined;
    async function* source(): AsyncIterable<CompletionChunk> {
      yield { text: '正文' };
      yield { text: '<think>尾巴', finished: true };
    }
    const out: CompletionChunk[] = [];
    for await (const c of sanitizeCompletionStream(source(), (s) => { stats = s; })) out.push(c);
    expect(stats).toEqual({ enteredThink: true, endedInsideThink: true, emittedTextLength: 2 });
  });

  it('reports stats for a clean stream that never enters think', async () => {
    let stats: SanitizerStats | undefined;
    async function* source(): AsyncIterable<CompletionChunk> {
      yield { text: '普通回复。', finished: true };
    }
    const out: CompletionChunk[] = [];
    for await (const c of sanitizeCompletionStream(source(), (s) => { stats = s; })) out.push(c);
    expect(stats).toEqual({ enteredThink: false, endedInsideThink: false, emittedTextLength: 5 });
  });
});
