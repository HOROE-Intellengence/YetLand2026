# 设计：提高主 AI 直接引语占比（温度门控）

- 日期：2026-06-05
- 分支：codex/preference-consolidation（commit 1，与温度契约 PR 协调，改同一批主 prompt 文件）
- 状态：待 review

## 问题

主 AI 输出几乎全是叙事 + 动作，缺少带引号的台词。分句侧袋
[`outputStructurer`](../../../apps/api/src/sidecar-ai/prompts.ts) 判 `dialogue`
依赖原文中的直接引语，主 AI 不给引号，它就只能把整段标成 `narration`，台词丢失独立呈现。

根因在**主 prompt**，不在分句侧袋。

## 目标

在主 prompt 层加入「叙事中需包含一定比例角色直接引语（用「」标出），避免整段只有旁白/动作」
的倾向性约束。不写死固定句数，给比例性 / 倾向性指引。

## 非目标

- 不改分句侧袋 `outputStructurer` 的识别逻辑（另议）。
- 不写死「每轮 N 句台词」这类硬配额。
- 不做无条件全局数量约束——低温/技术轮次不应被硬塞台词。

## 设计决策

### 1. 门控通道：温度（非阶段、非无条件）

台词需求与情感互动强相关：低温的技术求助 / 调试 / 账号 / 支付轮次不应被迫加台词
（与温度契约 PR 的「低温优先」同向）。因此按**温度**门控，挂在已有的每轮温度块通道
[`buildSidecarBlock` / `TEMPERATURE_GUIDANCE`](../../../apps/api/src/pipeline/chat-pipeline.ts)，
而非 `render.ts`（它只无条件拼模板，做不到门控）或 `stage_*.md`（粒度粗、当前为 TODO 空壳）。

### 2. 落点 A：`TEMPERATURE_GUIDANCE` 五档各追加台词倾向子句

保留每档**开头关键词前缀**（`冷淡疏离`/`微凉克制`/`暧昧升温`/`明显亲近`/`亲密无间`），
现有 `chat-pipeline.test.ts` 断言只认这些前缀，不破。

| 档 | 追加子句（倾向性，含「」标记） |
|---|---|
| 1 冷淡疏离 | 台词可有可无，不必为对话而对话。 |
| 2 微凉克制 | 台词简短即可，不强求。 |
| 3 暧昧升温 | 叙事中宜穿插角色直接台词（用「」标出），不要整段只剩旁白与动作。 |
| 4 明显亲近 | 多让角色开口（「」直接引语），台词与动作、心理交错推进。 |
| 5 亲密无间 | 以角色直接台词（「」）承载情感，避免大段旁白稀释临场感。 |

低温 1–2 显式豁免，中高温 3–5 递进鼓励。

### 3. 落点 B：`system.template.md` 全局格式约定（纯格式、非数量）

在 [`[全局表达约束]`](../../../packages/prompts/system.template.md) 块加一条：

> - 角色开口说的话用「」直接引出，与叙述、动作分开。

这是**格式约定**而非数量约束，不违反「温度门控数量」的决定。作用：哪怕低温偶发台词，
也能被分句侧袋正确标为 `dialogue`。render.test.ts 用内联模板、不读真实模板文件，不受影响。

## 数据流

```
温度判定(atmosphereJudge) → temperature(1-5)
  → buildSidecarBlock 拼 [温度演法：<含台词倾向子句>] → {{atmosphere_block}}
  → 主 AI 按倾向输出带「」台词
  → outputStructurer 识别「」为 dialogue
```

## 验收

- 人工对 3 个中高温样例回复：dialogue 段落明显增多。
- `pnpm test`（chat-pipeline、render）不破——断言只认温度档开头关键词与槽位行为，已核对。
- 低温样例（技术/调试输入）不出现硬塞台词。

## 改动文件

- `apps/api/src/pipeline/chat-pipeline.ts`（`TEMPERATURE_GUIDANCE` 五档追加子句）
- `packages/prompts/system.template.md`（`[全局表达约束]` 加一条格式约定）
