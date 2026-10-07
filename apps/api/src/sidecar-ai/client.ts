// 侧袋 AI 客户端 — 调便宜模型的薄函数
// 使用 OpenAI-compatible API 调轻量模型（DeepSeek 等），不做复杂抽象
import type { SidecarResult } from './types';
import type { SidecarPromptKey } from '@yelan/shared';
import { getLlmApiConfig } from '../services/llm-api-inventory';

/** 侧袋 AI 的模型配置 — 使用便宜模型 */
function getSidecarConfig(taskKey?: SidecarPromptKey) {
  // baseUrl = API 根（如 .../v1），下方 fetch 再拼 /chat/completions。
  // 容错后台粘贴了完整 .../v1/chat/completions：去掉重复后缀，否则拼出
  // .../chat/completions/chat/completions → 404（侧袋永久降级）。
  const normalizeBase = (url: string) => url.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const selected = getLlmApiConfig('sidecar', taskKey);
  if (selected) {
    return {
      model: selected.model,
      baseUrl: normalizeBase(selected.baseUrl),
      apiKey: selected.apiKey,
    };
  }
  return {
    model: process.env.SIDECAR_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat',
    baseUrl: normalizeBase(process.env.SIDECAR_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'),
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

/** 从 from 起、在当前 JSON 字符串闭合（遇未转义的 "）之前，是否还有一个 $ */
function hasUnescapedDollarAhead(s: string, from: number): boolean {
  for (let i = from; i < s.length; i++) {
    const c = s[i];
    if (c === '\\') { i += 1; continue; } // 跳过被转义的下一字符
    if (c === '"') return false; // 字符串结束仍没找到配对 $
    if (c === '$') return true;
  }
  return false;
}

/**
 * 修复侧袋结构化模型输出里「LaTeX 反斜杠未转义」导致的 JSON 腐化。
 *
 * 廉价模型被要求输出 json_object 时，常把公式里的 `\frac` `\times` `\neq` 写成单反斜杠。
 * 这在 JSON 里恰好是合法转义（`\f`=换页、`\t`=制表、`\n`=换行），于是 JSON.parse 不报错，
 * 却把 `\frac` 解成「换页符 + rac」—— 前端 KaTeX 拿到掏空了反斜杠的乱码，公式渲染失败、
 * `$` 也残留（用户报的「G 和 rac 中间有个向上箭头、$ 没消失」正是 U+000C 换页符）。
 *
 * 朴素的「只补非法转义」行不通：`\frac→\f`、`\times→\t`、`\neq→\n` 全撞上合法转义，
 * 而串外真正的 `\n` 又确实是换行。唯一可靠的判别是上下文 —— `$...$` 数学区内的反斜杠
 * 一律是 LaTeX 命令、应翻倍；区外的 `\n` 保持换行。故只在数学区内补斜杠。
 * 进入数学区前还要确认本串内有配对的 $，否则把货币写法（`$5`）误当公式开端。
 */
export function repairLatexBackslashes(raw: string): string {
  let out = '';
  let inString = false;
  let inMath = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (!inString) {
      if (c === '"') inString = true;
      out += c;
      continue;
    }
    // —— JSON 字符串内部 ——
    if (c === '\\') {
      const n = raw[i + 1];
      const isValidEscape =
        n === '\\' || n === '"' || n === '/' ||
        (n === 'u' && /^[0-9a-fA-F]{4}$/.test(raw.slice(i + 2, i + 6)));
      if (inMath && !isValidEscape) {
        out += '\\\\' + (n ?? ''); // 数学区裸反斜杠 → 翻倍，让 JSON.parse 还原出真正的 \
      } else {
        out += c + (n ?? ''); // 合法转义（含已正确翻倍的 \\）原样保留
      }
      i += 1;
      continue;
    }
    if (c === '"') {
      inString = false;
      inMath = false; // 串结束，数学区一并关闭，防漏配的 $ 渗到下一串
      out += c;
      continue;
    }
    if (c === '$') {
      const dbl = raw[i + 1] === '$';
      if (inMath || hasUnescapedDollarAhead(raw, i + (dbl ? 2 : 1))) {
        inMath = !inMath;
      }
      out += dbl ? '$$' : '$';
      if (dbl) i += 1;
      continue;
    }
    out += c;
  }
  return out;
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
        const json = extractSidecarJson(content);
        // 先按原样解析；失败再尝试修复 LaTeX 反斜杠后重解（避免对正常 JSON 多做一遍扫描）。
        // 但即便首解成功，公式里的 \frac 也可能被「合法地」解成换页符 —— 那类腐化不会抛错，
        // 故无条件先修复：repair 对不含数学区的 JSON 是恒等变换，开销仅一次线性扫描。
        const parsed = JSON.parse(repairLatexBackslashes(json)) as T;
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
  opts: { taskKey?: SidecarPromptKey; timeoutMs?: number; maxTokens?: number } = {},
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
