# 2026-05-16 — think 泄漏 P1 收尾：orphan-open 边界 + 空回复兜底 + sanitizer 观测出口

> 类型：实施回执（已落地，待 Codex 审计）
> 状态：Ready for Codex 交叉审计
> 出回执：Claude main，2026-05-16
> 上游：本刀是对 `2026-05-16-think-leak-and-prompt-cleanup.md` Codex 审计的收尾。
>       Codex 已落地 think-sanitizer + router 接入 + sidecar-prompts DELETE；本刀补 Codex
>       未覆盖的 orphan-open 边界，并按 PM 定稿加空回复兜底与观测出口。
> 审计方式：每条声称附「验证命令」，Codex 应机械复跑。

---

## 一段话版本

Codex 上一刀的 think-sanitizer 只测了孤立**闭**标签，漏了孤立**开**标签
（`<think>` 不闭合会吞光后文）。经 PM 定稿：**不改 sanitizer 剥离策略**（吞光是有意的
安全行为，避免泄漏思考内容），但要 ① 补 orphan-open 测试锁死该行为；② `chat.ts` 加空
回复兜底（被吞空时发安全台词）；③ 给 `sanitizeCompletionStream` 开一个 stats 出口，
让 `chat.ts` 能区分「quarantine 吞空 / provider 真空 / think-only 空 / 半截截断」四态，
否则日志是玄学。本刀已全部落地，typecheck 通过，22 文件 / 144 测试全绿。

---

## 背景：定稿前的两轮修正（事实记录）

1. Claude 初版建议「孤立开标签也当噪声、删标签后继续输出正文」——被 PM 否决。
   理由：孤立 `<think>` 无法区分「仅边界 token 漏入」与「真把思考内容倒进 content」，
   无法区分时对开标签必须按最坏情况（后文=思考）处理，否则泄漏 CoT。
2. 据此确认 sanitizer **现有行为本就正确**（`flush()` 在 `insideThink` 时返回 `''`，
   即孤立开标签后文全丢）。所以本刀对 sanitizer 剥离逻辑**零改动**，只补测试 + 观测。
3. Claude「加日志」最初没说清信号来源——PM 指出 `chat.ts` 只看到「空」无法归因，
   必须由 sanitizer 主动上报 `enteredThink / endedInsideThink / emittedTextLength`。

---

## 改动清单（4 处，全部在 `apps/api`）

### 改动 1 — `apps/api/src/llm/think-sanitizer.ts`：加观测出口

- 新增导出接口 `SanitizerStats { enteredThink, endedInsideThink, emittedTextLength }`。
- `ThinkTagSanitizer` 新增私有字段 `enteredThink`，进入 `<think>` 区段时置真；
  暴露 getter `hasEnteredThink` / `stillInsideThink`。
- `sanitizeCompletionStream` 新增可选第 2 参 `onStats?: (s: SanitizerStats) => void`，
  在 `try/finally` 的 `finally` 中触发——保证消费方提前 break / abort 也上报一次。
- **剥离逻辑（push/flush/drain*）一字未动。**

### 改动 2 — `apps/api/src/llm/router.ts`：透传 stats

- `stream()` 新增可选第 4 参 `onStats`，转交给 `sanitizeCompletionStream`。
- 失败链里每个 provider 的 sanitize 都带上 `onStats`；成功 provider 的回调最后触发，
  `chat.ts` 侧「后写覆盖」即取到成功 provider 的统计。

### 改动 3 — `apps/api/src/routes/chat.ts`：空回复兜底 + 四态归因

- 新增模块常量 `EMPTY_REPLY_FALLBACK`（安全兜底台词）与纯函数 `classifyEmptyReply`。
- 主 AI 流式调用 `router.stream(...)` 传入 onStats 回调，存进 `sanitizerStats`。
- 主流结束后、落库前：
  - `useReal && !assistantBuffer.trim()` → 按 `classifyEmptyReply` 写归因 warn 日志，
    `assistantBuffer` 置为兜底台词，并 `writeEv({kind:'chunk'})` **同时推 SSE**
    （非只落库——避免前端实时流仍空白）。
  - `useReal && sanitizerStats.endedInsideThink` 且 buffer 非空 → 半截截断，
    **不兜底**，写一条 `quarantine-truncated` 观测 warn。

### 改动 4 — `apps/api/src/llm/think-sanitizer.test.ts`：补 4 条测试

- 孤立开标签吞光后文（单 chunk）。
- 孤立开标签跨 chunk 吞后文，且 `finished` 仍透传。
- stats 出口：开标签吞尾时 `{enteredThink:true, endedInsideThink:true, emittedTextLength:2}`。
- stats 出口：干净流 `{enteredThink:false, endedInsideThink:false, emittedTextLength:5}`。

---

## 四态归因表（已落地行为）

| `emittedTextLength` | `enteredThink` | `endedInsideThink` | 判定 | `chat.ts` 动作 |
|---|---|---|---|---|
| 0 | false | false | provider 真空 | 兜底 + 记 `provider-empty` |
| 0 | true | true | 孤立开标签吞光 | 兜底 + 记 `quarantine-empty` |
| 0 | true | false | 只有完整 think 块、无正文 | 兜底 + 记 `think-only-empty` |
| >0 | true | true | 半截回复（尾段被吞） | 不兜底，记 `quarantine-truncated` |

注：`classifyEmptyReply` 仅在 `emittedTextLength === 0`（即 `assistantBuffer` 为空）
时被调用，故表中前 3 行由它归因；第 4 行是 buffer 非空、单独一条 warn。

---

## 验证命令（Codex 复跑）

| 声称 | 验证命令 | 期望 |
|---|---|---|
| typecheck 不破 | `pnpm --filter @yelan/api typecheck` | 无报错（已实跑：通过） |
| 全量测试全绿 | `pnpm --filter @yelan/api test` | 22 文件 / 144 测试全过（已实跑；较上版 +4，为新增 sanitizer 测试） |
| sanitizer 测试数 | 同上，看 `think-sanitizer.test.ts` | 11 tests（原 7 + 新 4） |
| chat 路由无回归 | 同上，看 `chat.test.ts` | 8 tests 全过 |
| 剥离逻辑未动 | `git diff apps/api/src/llm/think-sanitizer.ts` | 仅见 `SanitizerStats` / `enteredThink` / `onStats` 相关增量，`drainTextPending` 等剥离函数体无改 |

---

## 给 Codex 的审计重点

1. **复跑验证命令表**，确认 144 测试全绿、无回归。
2. **审 stats 触发时机**：`onStats` 在 `finally` 内——确认 router 失败链多 provider 时
   回调多次触发是否会让 `chat.ts` 取错统计（预期：成功 provider 最后触发，后写覆盖正确）。
3. **审空回复兜底位置**：是否确在「主流结束后、落库前」，且兜底既 `writeEv` 推 SSE
   又进 `assistantBuffer` 落库（两条都走）。
4. **审 orphan-open 行为是否被测试锁死**：确认新测试明确「未闭合 `<think>` 吞光后文」，
   防止后续有人误把它「修」成继续输出正文（那会泄漏 CoT）。
5. `emittedTextLength` 与 `assistantBuffer.length` 是否一致（两者都应是净化后可见文本）。

## 红线（本刀已遵守）

- ✅ sanitizer 剥离策略零改动——孤立开标签吞光后文是有意为之的安全行为。
- ✅ 未碰 `packages/shared`、未碰 `sidecar-ai/client.ts` 的 `response_format`。
- ✅ 未碰 `persistence.ts`——其「解析失败静默清空」高危缺陷是下一刀，单独修，
  不与本刀混合（见上一份报告 Part F.3）。

## 下一刀（建议，未开始）

按 Codex 优先级：修 `persistence.ts` 解析失败静默 `defaultState()` 的数据丢失隐患
——parse 失败时备份坏文件到 `.local/corrupt-state-<时间戳>.json` 并拒绝静默清空。
此刀与 think 泄漏无关，单独 PR。

## 当前工作树状态（uncommitted）

- `apps/api/src/llm/think-sanitizer.ts`、`router.ts`、`think-sanitizer.test.ts` —— 本刀已改。
- `apps/api/src/routes/chat.ts` —— 本刀已改（空回复兜底 + stats 接入）。
- `apps/api/src/sidecar-ai/prompts.ts` —— 上一刀的 `<think>` 丢弃规则（已记于前份报告）。
- 以上均未 commit。其余 git status 中的改动非本刀产生。
