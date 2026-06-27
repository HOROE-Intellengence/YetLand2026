// 侧袋 AI 客户端 — 调便宜模型的薄函数
// 使用 OpenAI-compatible API 调轻量模型（DeepSeek 等），不做复杂抽象
import type { SidecarResult } from './types';
import type { SidecarPromptKey } from '@yelan/shared';
import { getLlmApiConfig } from '../services/llm-api-inventory';

/** 侧袋 AI 的模型配置 — 使用便宜模型 */
function getSidecarConfig(taskKey?: SidecarPromptKey) {
  const selected = getLlmApiConfig('sidecar', taskKey);
  if (selected) {
    return {
      model: selected.model,
      baseUrl: selected.baseUrl.replace(/\/+$/, ''),
      apiKey: selected.apiKey,
    };
  }
  return {
    model: process.env.SIDECAR_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    baseUrl: (process.env.SIDECAR_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1').replace(/\/+$/, ''),
    apiKey: process.env.SIDECAR_API_KEY || process.env.DEEPSEEK_API_KEY || '',
  };
}

/** 是否有可用的侧袋 AI */
export function sidecarReady(taskKey?: SidecarPromptKey): boolean {
  const config = getSidecarConfig(taskKey);
  return !!config.apiKey && config.apiKey.length > 10;
}

const SIDECAR_DEFAULT_TIMEOUT_MS = 5000;

/**
 * 从模型返回里抠出可解析的 JSON。
 * OpenAI 兼容代理（尤其 gemini 系）常无视 response_format，返回 markdown 代码围栏、
 * <think> 前缀或前后散文。裸 JSON.parse 会直接失败 → 侧袋每次降级 → 分句永远不生效。
 * 这里按「去 think → 拆围栏 → 截取首尾括号」三步归一，对已是裸 JSON 的输入保持原样。
 */
export function extractSidecarJson(raw: string): string {
  let s = raw.trim();
  // 去掉 <think>…</think>（取最后一个闭合标签之后的内容）
  const thinkClose = s.lastIndexOf('</think>');
  if (thinkClose >= 0) s = s.slice(thinkClose + '</think>'.length).trim();
  // 拆掉 markdown 代码围栏 ```json … ``` / ``` … ```
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  // 退路：剥掉首个 { 或 [ 之前、最后一个 } 或 ] 之后的散文
  const starts = [s.indexOf('{'), s.indexOf('[')].filter((i) => i >= 0);
  if (starts.length > 0) {
    const start = Math.min(...starts);
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (end > start) s = s.slice(start, end + 1);
  }
  return s;
}

/**
 * 调侧袋 AI：发送 system prompt + user content，返回解析后的 JSON
 * 失败时返回 { ok: false } 而非抛异常 — 调用方自行降级
 */
export async function sidecarCall<T>(
  systemPrompt: string,
  userContent: string,
  opts: { taskKey?: SidecarPromptKey; timeoutMs?: number; maxTokens?: number } = {},
): Promise<SidecarResult<T>> {
  if (!sidecarReady(opts.taskKey)) {
    return { ok: false, error: 'no sidecar API key configured' };
  }

  const timeoutMs = opts.timeoutMs ?? SIDECAR_DEFAULT_TIMEOUT_MS;

  try {
    const config = getSidecarConfig(opts.taskKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userContent },
          ],
          temperature: 0.3,
          max_tokens: opts.maxTokens ?? 1024,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `sidecar API ${res.status}: ${text.slice(0, 200)}` };
      }

      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return { ok: false, error: 'empty sidecar response' };
      }

      try {
        const parsed = JSON.parse(extractSidecarJson(content)) as T;
        return { ok: true, data: parsed };
      } catch {
        return { ok: false, error: `sidecar JSON parse failed: ${content.slice(0, 200)}` };
      }
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      return { ok: false, error: `sidecar timeout after ${timeoutMs}ms` };
    }
    return { ok: false, error: `sidecar fetch failed: ${(e as Error).message}` };
  }
}

/**
 * 调侧袋 AI 并做 zod 校验
 * 校验失败返回 { ok: false }
 */
export async function sidecarCallWithSchema<T>(
  systemPrompt: string,
  userContent: string,
  schema: { safeParse: (data: unknown) => { success: boolean; data?: T; error?: { issues: Array<{ message: string }> } } },
  opts: { taskKey?: SidecarPromptKey; timeoutMs?: number } = {},
): Promise<SidecarResult<T>> {
  const result = await sidecarCall<T>(systemPrompt, userContent, opts);
  if (!result.ok) return result;

  const parsed = schema.safeParse(result.data);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return {
    ok: false,
    error: `schema validation: ${parsed.error?.issues?.map((i: { message: string }) => i.message).join(', ') ?? 'unknown'}`,
  };
}
