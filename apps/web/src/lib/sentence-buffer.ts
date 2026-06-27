// 把流式 chunk 缓冲成"句"，按 sentence_end / glow 元数据驱动浮现
import type { ChatStreamEvent } from '@yelan/shared';

export interface BufferedSentence {
  text: string;
  glow: boolean;
}

export class SentenceBuffer {
  private buffer = '';
  private out: BufferedSentence[] = [];

  feed(event: ChatStreamEvent): BufferedSentence[] {
    if (event.kind !== 'chunk') return [];
    this.buffer += event.text;
    if (event.sentenceEnd) {
      const s: BufferedSentence = { text: this.buffer, glow: !!event.glow };
      this.buffer = '';
      this.out.push(s);
      return [s];
    }
    return [];
  }

  drain(): BufferedSentence[] {
    if (!this.buffer) return [];
    const s: BufferedSentence = { text: this.buffer, glow: false };
    this.buffer = '';
    this.out.push(s);
    return [s];
  }
}
