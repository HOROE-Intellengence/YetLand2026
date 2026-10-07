import type { NativeTimelineEntry } from './short-term-assembler';

// Split before upload; an entry is acknowledged only after every part succeeds.
// Slice by code points so a split never corrupts an emoji or supplementary CJK.
export function memoryParts(entry: Pick<NativeTimelineEntry, 'timestamp' | 'content'>): string[] {
  const prefix = `[${String(entry.timestamp).slice(0, 100)}] `;
  const limit = 6000 - prefix.length;
  const parts: string[] = [];
  let part = '';
  for (const point of entry.content) {
    if (part.length + point.length > limit) { parts.push(prefix + part); part = ''; }
    part += point;
  }
  if (part.length) parts.push(prefix + part);
  return parts;
}
