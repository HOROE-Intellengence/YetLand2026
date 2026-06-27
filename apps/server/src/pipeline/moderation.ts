// 输入侧守门：黑名单 → OpenAI Moderation（毫秒级）→ 通过
import type { Env } from '../types/bindings';

// Stub: full moderation implementation pending（实装时用 _apiKey 调 createOpenAIProvider 判 _text）
async function moderate(_apiKey: string | undefined, _text: string): Promise<{ flagged: boolean; categories: string[] }> {
  return { flagged: false, categories: [] };
}

const BLOCKLIST: string[] = [
  // 涉政 / 未成年 / 极端暴力 — 终态词典放配置或 KV
];

export async function moderateInput(env: Env, text: string): Promise<{ ok: boolean; reason?: string }> {
  for (const w of BLOCKLIST) {
    if (text.includes(w)) return { ok: false, reason: 'blocklist' };
  }
  const m = await moderate(env.OPENAI_API_KEY, text);
  if (m.flagged) return { ok: false, reason: m.categories.join(',') };
  return { ok: true };
}
