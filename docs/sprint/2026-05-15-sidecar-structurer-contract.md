# BE-143 — 侧袋 structureOutput 的 prompt↔schema 契约修复

> 类型：Spec / 工单详情（实施细则）
> 状态：Ready for DeepSeek
> 出 spec：Claude main（PM/架构师），2026-05-15
> 前置验证：本会话已实测确认（见下「背景」）

---

## 背景（已实测的事实，非推测）

为侧袋 AI 配置便宜模型（`gemini-3.1-flash-lite` / `https://horoe.cn/v1`）后做端到端验证，
发现侧袋的 `structureOutput`（结构拆句）任务 **100% 失败**。

实测证据：

1. 连通性正常 —— 后台 `POST /api/admin/llm-apis/test` 返 `{"ok":true,"latencyMs":2391}`；
   `diagnostics/test-all` 对 `sidecar-gemini` 返 `ok:true`。
2. 侧袋真实代码路径 `structureOutput()` 返 `{"ok":false,"error":"schema validation: Expected object, received array"}`。
3. 直接 dump `sidecarCall` 原始返回 —— 模型返回的是 **JSON 数组**：
   ```json
   [ {"type":"action","text":"..."},
     {"type":"dialogue","text":"\"我也要……\""},
     {"type":"action","text":"..."} ]
   ```
   拆解质量本身没问题，问题在数据形状。

## 根因

项目自身的 **prompt 与 schema 契约不一致**：

- `apps/api/src/sidecar-ai/prompts.ts` 的 `outputStructurer` 默认 prompt（约 L23-40）
  明确指示模型 **「输出 JSON 数组 `[...]`」**。
- `packages/shared/src/schemas/sidecar.ts` L10-12 的 `OutputStructurerResultSchema`
  却要求 **对象 `{ parts: [...] }`**：
  ```ts
  export const OutputStructurerResultSchema = z.object({
    parts: z.array(StructuredMessagePartSchema),
  });
  ```

模型忠实跟随 prompt 返回数组 → `sidecarCallWithSchema` 的 zod 校验失败 →
`structureOutput` 返 `ok:false` → 调用方 `apps/api/src/routes/chat.ts:101` 静默降级到
`fallbackStructure`（正则按句切、**全部标 narration**）。应用不崩，但 AI 拆解空转。

这不是 gemini 的问题 —— gemini 只是把潜伏 bug 暴露成必现（它不强制
`response_format:json_object` 的对象化，所以严格跟了 prompt 文本）。

## 修复方案（PM 已定，按此实施，不要自行改设计）

两处改动，**全部在 `apps/api` 内**，不碰 `packages/shared`。

### 改动 1 — `apps/api/src/sidecar-ai/output-structurer.ts`

新增一个**导出的纯函数** `normalizeStructurerParts`，并让 `structureOutput` 走它。
目的：无论模型返回数组还是对象，都归一成 `{ parts: [...] }` 再交给 schema 校验。

代码骨架（按此写，命名不要改）：

```ts
import type { OutputStructurerResult, SidecarResult } from './types';
import { getPrompt } from './prompts';
import { sidecarCall } from './client';
import { OutputStructurerResultSchema } from '@yelan/shared';

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
  const raw = await sidecarCall<unknown>(prompt, rawText);
  if (!raw.ok) return raw;

  const normalized = normalizeStructurerParts(raw.data);
  const parsed = OutputStructurerResultSchema.safeParse(normalized);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return {
    ok: false,
    error: `schema validation: ${parsed.error.issues.map((i) => i.message).join(', ')}`,
  };
}
```

`fallbackStructure` 保持不动。

### 改动 2 — `apps/api/src/sidecar-ai/prompts.ts`

把 `outputStructurer` 默认 prompt 里要求「输出 JSON 数组」的部分改成要求
**对象 `{ "parts": [...] }`**，让 prompt 与 schema 一致（减少对归一兜底的依赖）。

具体：把 prompt 中段的格式示例从

```
根据文本内容，将每个句子或段落分类为以下类型，输出 JSON 数组：
[
  { "type": "dialogue", "text": "角色说的台词" },
  ...
]
```

改成

```
根据文本内容，将每个句子或段落分类为以下类型，输出 JSON 对象，
所有片段放在 "parts" 数组里：
{
  "parts": [
    { "type": "dialogue", "text": "角色说的台词" },
    { "type": "action", "text": "动作描写" },
    { "type": "environment", "text": "环境/背景描写" },
    { "type": "narration", "text": "心理/旁白" }
  ]
}
```

并把末尾「只输出 JSON 数组」改成「只输出 JSON 对象」。规则列表（type 取值等）保持不动。

### 改动 3 — 新增 `apps/api/src/sidecar-ai/output-structurer.test.ts`

vitest 单测，覆盖 `normalizeStructurerParts` + 回归保护 `fallbackStructure`：

- 数组输入 `[{type,text}]` → `{ parts: [...] }`，长度对得上
- 对象输入 `{ parts: [...] }` → 原样返回 parts
- 垃圾输入（`null` / `"string"` / `{}`）→ `{ parts: [] }`
- `fallbackStructure('句子一。句子二。')` → 每个 part `type === 'narration'`

不要 mock 网络（`normalizeStructurerParts` / `fallbackStructure` 都是纯函数，直接测）。

## 红线（复述，必须遵守）

- ❌ 不改 `packages/shared/src/schemas/sidecar.ts` —— `OutputStructurerResultSchema`
  保持 `{ parts: [...] }`。`apps/server` 也用它，blast radius 大。
- ❌ 不改 `client.ts` 的 `response_format: { type: 'json_object' }` —— 其余 4 个侧袋
  任务（preferenceRecorder / atmosphereJudge / quotaEnding / contextCompressor）依赖它。
- ❌ 不"顺便"修 `apps/api/src/index.ts` L118 `/health` 的 sidecar 展示 bug
  （那是另一个工单，本工单不碰）。
- ❌ 不动其他侧袋文件。
- ✅ 一 commit 一工单。commit message：
  `fix(api): tolerate array output in sidecar structurer (BE-143)`

## 验收命令（成功 criteria —— 全部通过才算完成）

```
(a) pnpm --filter @yelan/api typecheck
    → 无报错

(b) pnpm --filter @yelan/api test
    → 全绿，且输出含新文件 output-structurer.test.ts 的用例通过

(c) pnpm verify:gray
    → 全绿（lint + typecheck + test:gray + contracts）

(d) 端到端（需 apps/api 起在 8787 且 state.json 已配 sidecar-gemini）：
    在 apps/api 目录跑一段临时脚本调 structureOutput('他笑了。"留下来。"声音沙哑。')
    → 返回 { ok: true, data: { parts: [...] } }，parts 是非空数组
    （脚本验证完即删，不留 scratch 文件）
```

## 报告格式要求

完成后写 `docs/sprint/2026-05-15-report.md`（或追加），每个声称附「验证命令」列，
让 Codex 能机械复跑。没有「验证命令」列的报告 = 返修。

## 一段话版本

侧袋 `structureOutput` 因 prompt 要数组、schema 要对象而 100% 失败、静默降级到正则兜底。
修复：在 `output-structurer.ts` 加 `normalizeStructurerParts` 把数组/对象都归一成
`{parts:[...]}` 再做 schema 校验，并把 `prompts.ts` 的 `outputStructurer` 默认 prompt
改成要求对象格式；加 `output-structurer.test.ts` 单测。不碰 shared schema、不碰
`response_format`、不碰 `/health`。验收靠 `pnpm --filter @yelan/api test` +
`pnpm verify:gray` 全绿 + 端到端 `structureOutput` 返 `ok:true`。
