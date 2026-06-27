// 结构拆句 AI — 每次主 AI 输出后触发
// 将长篇叙事文本拆分为结构化消息片段（台词/动作/环境/旁白）
import type { OutputStructurerResult, SidecarResult } from './types';
import { getPrompt } from './prompts';
import { sidecarCall } from './client';
import { OutputStructurerResultSchema, type MessagePartType } from '@yelan/shared';

// 分句侧袋的调用超时。3000ms 对「经代理的轻量模型 + 多句 JSON 结构化」常常太紧，
// 真实分句结果总在 abort 之后才回 → 永远降级正则。放宽默认到 8000ms，并允许 env 调。
export const OUTPUT_STRUCTURER_TIMEOUT_MS = Number(process.env.SIDECAR_STRUCTURER_TIMEOUT_MS) || 8000;

// 分句把原文每句包成 {"type","text"}，结构开销让长回复在默认 1024 token 处被截断 →
// JSON.parse 失败 → 整段降级正则（台词丢竖线，与旁白混同）。给分句更高的 token 上限。
export const OUTPUT_STRUCTURER_MAX_TOKENS = Number(process.env.SIDECAR_STRUCTURER_MAX_TOKENS) || 2048;

const VALID_PART_TYPES: ReadonlySet<MessagePartType> = new Set<MessagePartType>([
  'dialogue',
  'action',
  'environment',
  'narration',
]);

/**
 * 逐句容错归一：模型偶尔吐非法 type（如 "speech"）或某句缺 text，
 * 原本整批 schema 校验会全有或全无地失败 → 整段降级。这里逐句抢救：
 *   - 非法/缺失 type 归一为 narration（保留文本可读，只是丢竖线）
 *   - 丢弃没有有效文本的 part
 * 只要还剩至少一句，就不必整段降级。
 */
export function coerceStructurerParts(parts: unknown[]): OutputStructurerResult['parts'] {
  const out: OutputStructurerResult['parts'] = [];
  for (const raw of parts) {
    if (!raw || typeof raw !== 'object') continue;
    const text = (raw as { text?: unknown }).text;
    if (typeof text !== 'string' || !text.trim()) continue;
    const rawType = (raw as { type?: unknown }).type;
    const type =
      typeof rawType === 'string' && VALID_PART_TYPES.has(rawType as MessagePartType)
        ? (rawType as MessagePartType)
        : 'narration';
    out.push({ type, text });
  }
  return out;
}

/**
 * 归一侧袋返回的形状 —— 模型可能返回裸数组，也可能返回 { parts: [...] }。
 * 统一包成 { parts: [...] }，交给 schema 做严格校验。
 */
export function normalizeStructurerParts(data: unknown): { parts: unknown[] } {
  if (Array.isArray(data)) return { parts: data };
  if (data && typeof data === 'object' && Array.isArray((data as { parts?: unknown }).parts)) {
    return { parts: (data as { parts: unknown[] }).parts };
  }
  return { parts: [] };
}

export async function structureOutput(
  rawText: string,
): Promise<SidecarResult<OutputStructurerResult>> {
  if (!rawText.trim()) {
    return { ok: false, error: 'empty input' };
  }

  const prompt = getPrompt('outputStructurer');
  const raw = await sidecarCall<unknown>(prompt, rawText, {
    taskKey: 'outputStructurer',
    timeoutMs: OUTPUT_STRUCTURER_TIMEOUT_MS,
    maxTokens: OUTPUT_STRUCTURER_MAX_TOKENS,
  });
  if (!raw.ok) return { ok: false, error: raw.error };

  // 先逐句容错归一，再用 schema 兜底确认形状。逐句抢救让「一个坏 part」
  // 不再整段降级 —— 只要还剩至少一句有效，台词的结构就能保住。
  const coerced = coerceStructurerParts(normalizeStructurerParts(raw.data).parts);
  const parsed = OutputStructurerResultSchema.safeParse({ parts: coerced });
  if (parsed.success && parsed.data.parts.length > 0) {
    return { ok: true, data: parsed.data };
  }
  if (parsed.success) {
    return { ok: false, error: 'schema validation: no usable parts after coercion' };
  }
  return {
    ok: false,
    error: `schema validation: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
  };
}

/**
 * 降级方案：用正则将文本按句拆分，全部标为 narration 类型
 * 当侧袋 AI 不可用或调用失败时使用
 */
export function fallbackStructure(rawText: string): OutputStructurerResult {
  const sentences = rawText.split(/(?<=[。！？…!?]["」』）)]?\s*)/);
  const parts = sentences
    .filter((s) => s.trim())
    .map((text) => ({ type: 'narration' as const, text: text.trim() }));
  return { parts };
}
