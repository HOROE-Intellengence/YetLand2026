# 主 AI reasoning_effort 接入 + minimal vs low A/B 实测

日期：2026-06-06
端点：`gemini-3.1-flash-lite @ https://horoe.cn/v1`（OpenAI 兼容代理，线上主 AI 实配）

## 1. 官方文档核实（一手来源）

来源：[ai.google.dev/gemini-api/docs/openai](https://ai.google.dev/gemini-api/docs/openai)、
[gemini-3.1-flash-lite 模型卡](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite)。

- Gemini OpenAI 兼容层**支持** `reasoning_effort`，取值 `minimal` / `low` / `medium` / `high` / `none`，
  自动映射到 Gemini 3 的 `thinking_level`。
- 对 `gemini-3.1-flash-lite` 是 **1:1 映射**（minimal→minimal、low→low、medium→medium、high→high；
  注意 3.1-**pro** 的 minimal 会被抬成 low）。
- flash-lite **默认 thinking_level = minimal** → 印证"原本不传 ≈ minimal"，切到 low 是真实的"多想一档"。
- `reasoning_effort` 与 `thinking_level`/`thinking_budget` **不能同时传**，故只发 `reasoning_effort` 一个字段。
- 风险参考：[LiteLLM #22721](https://github.com/BerriAI/litellm/issues/22721) 报 LiteLLM 系代理对
  flash-lite 的 `reasoning_effort` 会 400 —— 但本次实测 horoe.cn 透传正常（0 错误），不受此 bug 影响。

## 2. 实现摘要

- `packages/llm/src/types.ts`：`CompletionRequest` 增加 `reasoningEffort?: ReasoningEffort`（4 档联合类型）。
- `packages/llm/src/providers/openai.ts`：仅当 `req.reasoningEffort` 存在 **且** 模型族受支持
  （`gemini-[3-9]` / `gpt-5` / o 系列）时，才把 `reasoning_effort` 写进 body；否则保持原样，
  兼容不认识该参数的代理/模型。
- 后台可调（admin store）：`llmApiInventory` 新增 `mainReasoningEffort`（默认 `low`）与
  `mainReasoningEffortCipher`（默认 `low`），经 `POST /api/admin/llm-apis/reasoning-effort` 设置，
  admin「服务配置」页有控件。
- 调用侧：`chat.ts` 按 `sessionIfActive` 选择普通/暗号档位 → `streamMainLLM` → `router.stream` → provider。
- 测试：`packages/llm/.../openai-provider.test.ts`（守卫逻辑）、`llm-api-inventory.test.ts`（get/set）。
  既有 provider 行为不变，api 全量 304 用例通过。

## 3. minimal vs low 实测（rounds=3，每档 3 输入 × 3 轮 = 9 次）

脚本：`node scripts/bench-reasoning.mjs --rounds=3`；原始数据：`scripts/.bench-reasoning-2026-06-06T08-11-52-597Z.json`

| 档位 | n | 错误 | think 泄漏率 | total P50 | total P90 | TTFT P50 | completion tokens 中位 |
|------|---|------|-------------|-----------|-----------|----------|------------------------|
| minimal | 9 | 0 | **0/9** | 5822ms | 7786ms | 5066ms | **68** |
| low | 9 | 0 | **0/9** | 5892ms | 7457ms | 5443ms | **404** |

### 结论

1. **think 泄漏：两档都是 0**。flash-lite 经 horoe 不吐 `<think>`，sanitizer 在这条链路上几乎无事可做——
   "think 泄漏"不是切档要担心的风险。
2. **延时基本持平**（P50 5822 vs 5892ms，差异在噪声内）。该代理 TTFT≈total（近非流式），
   墙钟时间由代理固定开销主导，多一档思考没有显著拖慢。
3. **代价在 token**：low 的 completion tokens 中位从 68 跳到 404（~6×）。这是切到 low 的主要成本，
   质量收益需人工对比 `qualityScore`（脚本已预留该列为 null，待回填 1-5 分）后再定夺。

> 注：本次为小规模样本（n=9/档），用于打通链路并给出量级。正式评估建议 rounds≥15 并回填质量分。

## 4. 全四档对比（minimal / low / medium / high，rounds=3）

脚本：`node scripts/bench-reasoning.mjs --rounds=3 --efforts=minimal,low,medium,high`
原始数据：`scripts/.bench-reasoning-2026-06-06T09-52-37-058Z.json`

| 档位 | n | 错误 | think 泄漏率 | total P50 | total P90 | TTFT P50 | completion tokens 中位 |
|------|---|------|-------------|-----------|-----------|----------|------------------------|
| minimal | 9 | 0 | 0/9 | 6213ms | 7818ms | 5341ms | **58** |
| low | 9 | 0 | 0/9 | 6296ms | 9887ms | 5559ms | **425** |
| medium | 9 | 0 | 0/9 | 8112ms | 12033ms | 6944ms | **687** |
| high | 9 | 0 | 0/9 | 6409ms | 9593ms | 6361ms | **711** |

### 结论

1. **think 泄漏与档位无关：全四档都是 0/9**。再次确认这条链路上 sanitizer 无事可做。
2. **输出量随档位单调上升，但边际递减**：58 → 425 → 687 → 711。
   - `minimal→low` 是质变拐点（~7× token）；
   - `low→medium` 再 +60%；
   - `medium→high` 几乎持平（687→711，+3%）—— high 相对 medium 基本只多花钱、不多产出。
3. **延时受代理抖动主导，档位间无清晰单调关系**：minimal/low/high 的 P50 都落在 6.2–6.4s，
   medium 反而 P50 最高（8.1s，被一个 12s 离群值拉高）。这是 n=9 小样本噪声，
   真实延时差异需 rounds≥15 才能看清。TTFT≈total（代理近非流式）。

### 选档建议（待质量分回填后定稿）

- **low = 性价比拐点**：相对 minimal 输出大幅变丰富，延时基本不变 → 适合普通场景默认（已设为默认）。
- **medium**：token 再 +60%，可留给暗号/情绪高点等"值得多想"的场景。
- **high 不划算**：相对 medium token 几乎持平，延时也没优势，纯多花钱。
