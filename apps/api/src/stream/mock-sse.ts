// 句级 SSE 模拟流 — 让前端能跑出"句级浮现 + glow + 关键句停顿"完整体验
import { DEFAULT_USER_BOUNDARY, type ChatStreamEvent } from '@yelan/shared';

const SCRIPT: { text: string; glow?: boolean }[] = [
  { text: '今夜，你来得比我想得早。' },
  { text: '我以为你不会再来。' },
  { text: '其实——', glow: true },
  { text: '我等了你很久。', glow: true },
  { text: '坐下吧。' },
];

const LATENCY = Number(process.env.MOCK_LATENCY_MS ?? 120);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function* mockChatStream(): AsyncGenerator<ChatStreamEvent> {
  yield { kind: 'meta', stage: 'daily', boundary: DEFAULT_USER_BOUNDARY };
  for (const s of SCRIPT) {
    // 模拟 token 级 chunk：每 3 字一段
    for (let i = 0; i < s.text.length; i += 3) {
      const piece = s.text.slice(i, i + 3);
      const isLast = i + 3 >= s.text.length;
      await sleep(LATENCY);
      yield {
        kind: 'chunk',
        text: piece,
        sentenceEnd: isLast,
        glow: isLast ? !!s.glow : false,
      };
    }
    if (s.glow) await sleep(700); // 关键句额外停顿（修订 #25）
  }
  yield { kind: 'done' };
}
