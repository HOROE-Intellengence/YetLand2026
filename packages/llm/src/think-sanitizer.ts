import type { CompletionChunk } from './types';

const OPEN_TAG = '<think>';
const CLOSE_TAG = '</think>';
const TAGS = [OPEN_TAG, CLOSE_TAG] as const;

export interface SanitizerStats {
  enteredThink: boolean;
  endedInsideThink: boolean;
  emittedTextLength: number;
}

function isTagPrefix(value: string): boolean {
  const lower = value.toLowerCase();
  return TAGS.some((tag) => tag.startsWith(lower));
}

function longestClosingTagPrefixSuffix(value: string): string {
  const max = Math.min(value.length, CLOSE_TAG.length - 1);
  for (let len = max; len > 0; len -= 1) {
    const suffix = value.slice(-len);
    if (CLOSE_TAG.startsWith(suffix.toLowerCase())) return suffix;
  }
  return '';
}

class ThinkTagSanitizer {
  private pending = '';
  private insideThink = false;
  private enteredThink = false;

  get hasEnteredThink(): boolean {
    return this.enteredThink;
  }

  get stillInsideThink(): boolean {
    return this.insideThink;
  }

  push(text: string): string {
    let output = '';
    for (const char of text) {
      output += this.insideThink ? this.consumeThinkChar(char) : this.consumeTextChar(char);
    }
    return output;
  }

  flush(): string {
    if (this.insideThink) {
      this.pending = '';
      return '';
    }
    const tail = this.pending;
    this.pending = '';
    return tail;
  }

  private consumeTextChar(char: string): string {
    if (!this.pending && char !== '<') return char;

    this.pending += char;
    return this.drainTextPending();
  }

  private drainTextPending(): string {
    let output = '';

    while (this.pending) {
      const lower = this.pending.toLowerCase();
      if (lower === OPEN_TAG) {
        this.pending = '';
        this.insideThink = true;
        this.enteredThink = true;
        return output;
      }
      if (lower === CLOSE_TAG) {
        this.pending = '';
        return output;
      }
      if (isTagPrefix(this.pending)) return output;

      output += this.pending[0]!;
      this.pending = this.pending.slice(1);
    }

    return output;
  }

  private consumeThinkChar(char: string): string {
    if (!this.pending && char !== '<') return '';

    this.pending += char;
    this.drainThinkPending();
    return '';
  }

  private drainThinkPending(): void {
    while (this.pending) {
      const lower = this.pending.toLowerCase();
      if (lower === CLOSE_TAG) {
        this.pending = '';
        this.insideThink = false;
        return;
      }
      if (CLOSE_TAG.startsWith(lower)) return;

      this.pending = longestClosingTagPrefixSuffix(this.pending);
    }
  }
}

export async function* sanitizeCompletionStream(
  source: AsyncIterable<CompletionChunk>,
  onStats?: (stats: SanitizerStats) => void,
): AsyncIterable<CompletionChunk> {
  const sanitizer = new ThinkTagSanitizer();
  let emittedTextLength = 0;

  try {
    for await (const chunk of source) {
      let text = chunk.text ? sanitizer.push(chunk.text) : '';
      if (chunk.finished) text += sanitizer.flush();

      if (text || chunk.finished || chunk.usage) {
        emittedTextLength += text.length;
        yield { ...chunk, text };
      }
    }

    const tail = sanitizer.flush();
    if (tail) {
      emittedTextLength += tail.length;
      yield { text: tail };
    }
  } finally {
    onStats?.({
      enteredThink: sanitizer.hasEnteredThink,
      endedInsideThink: sanitizer.stillInsideThink,
      emittedTextLength,
    });
  }
}
