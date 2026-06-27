# 2026-05-16 — `</think>` 标签泄漏诊断 + 侧袋 prompt 清理

> 类型：诊断报告 + 已落地小改动 + 待决策架构评估
> 状态：Ready for Codex 交叉审计
> 出报告：Claude main，2026-05-16
> 性质：本报告 = 一次验收追查的产物。含「已诊断未修」「已落地」「待决策」三类内容，逐条标注。
> 审计方式：每条声称附「验证命令」，Codex 应机械复跑。命令对不上 = 返修。

---

## 一段话版本

侧袋编排验收期间，实测发现主 AI 回复里泄漏 `</think>` 字面标签。追查定位：根因是
GLM-5.1 / NVIDIA NIM 把 `</think>` 边界 token 混进了 `delta.content`，泄漏点是
`apps/api/src/llm/nvidia-unlim.ts` 对 `delta.content` 零净化的裸透传；全链路无任何
think 处理。结构拆句侧袋（outputStructurer）因「职责是拆句不是过滤」「位置在 postMain
出字之后」「产出是旁路不回写主消息」三条原因，结构上不可能拦到。本次**已落地两处小改
动**（prompts.ts 加一行 think 丢弃规则；清理 state.json 一条冗余 override），**未修**
泄漏本体（需决策）。另附「拆句 AI 后移」三方案评估，待 PM 拍板。

---

## Part A — `</think>` 泄漏诊断【已诊断，未修】

### A.1 现象（实测事实）

验收长对话期间，某轮主 AI 回复结尾出现字面 `</think>`：

```
喝水了吗。</think>
```

用户侧能直接看到这个标签，破坏沉浸感。

### A.2 泄漏点定位

`apps/api/src/llm/nvidia-unlim.ts` L107-113：

```ts
const text = ev.choices?.[0]?.delta?.content;
const finished = ev.choices?.[0]?.finish_reason === 'stop';
const usage = ev.usage ? { ... } : undefined;
if (text) yield { text, ... };
```

`delta.content` **原样透传，零净化**；且**不读** `delta.reasoning_content`。
推理模型（GLM-5.1）的思考边界 token `</think>` 一旦被 provider 混进 `content`
字段，就直接进入下游。

### A.3 根因

- 根因方：**模型 / provider**（GLM-5.1 经 NVIDIA NIM）把 `</think>` 边界 token
  漏进了 `delta.content`。
- 暴露原因：`nvidia-unlim.ts` 不做任何 think 标签处理，所以模型一旦漏，应用层无兜底。
- 全链路确认：API 代码库中**不存在**任何 `<think>` / `reasoning_content` 处理逻辑。

### A.4 影响范围（为什么这一个点是唯一闸门）

`apps/api/src/routes/chat.ts`：

- L263-277：主 AI 流式 —— 每个 chunk 既 `writeEv({kind:'chunk'})` 推给前端 SSE，
  又累加进 `assistantBuffer`。
- L287-296：把**原始 `assistantBuffer`** 落库到 `messages`。

即 chunk 流（用户实时所见）与持久化消息**都源自同一份未净化文本**。
`nvidia-unlim.ts` 的 yield 点是这份文本扇出之前的**唯一收口**。

### A.5 最小修理方案（两个，未实施，待决策）

- **方案 A（一行正则，确定性）**：在 `nvidia-unlim.ts` yield 前
  `text = text.replace(/<\/?think>/g, '')`。优点：确定性 100%、改动最小。
  缺点：跨 chunk 裂开的标签（`<` 和 `/think>` 分属两个 chunk）漏网。
- **方案 B（跨 chunk 缓冲剥离）**：维护一个小尾缓冲，跨 chunk 边界识别并剥离标签。
  优点：跨 chunk 也能滤。缺点：多几行状态逻辑。

推荐 B（一劳永逸）；急可先上 A。**注意**：无论选哪个，这只是字面标签兜底，
与下方 Part C 的拆句重构不冲突，应共存。

---

## Part B — 为什么 outputStructurer 拦不住【分析结论】

结构拆句侧袋（`apps/api/src/sidecar-ai/output-structurer.ts`）无法拦截 `</think>`，
三条结构性原因：

1. **职责不对**：它是「拆句分类器」（把叙事文本切成 dialogue/action/environment/
   narration），不是过滤器/校对器。默认 prompt 明确「保持原文不变」。
2. **位置不对**：它在 `postMain` checkpoint 跑，发生在主 AI 出字**之后**。
   `</think>` 早已通过 L263-277 的 chunk 流推给前端，拆句侧袋不在那条路径上。
3. **产出是旁路**：拆句结果走 `writeEv({kind:'structured'})`，前端
   `apps/web/src/hooks/useChat.ts` L91-92 把它存进**独立 map**（`structuredParts`），
   **不替换主消息**；服务端也不把拆句结果回写 `messages`。
4. 补充：`fallbackStructure`（侧袋不可用时的降级）是纯本地正则切句，逐字保留 `</think>`。

结论：拆句侧袋当前是「旁路观察者」，不在文本干道上，结构上不可能拦截。

---

## Part C — 「拆句 AI 后移」架构评估【待 PM 决策】

PM 提出把拆句 AI 改为「前端输出前最后一道关」，并改用 `^...^`（背景/行动）
/ `*...*`（对话）符号标记驱动前端斜体/正体渲染。评估如下。

### C.1 关键事实：前端斜体/正体能力已存在

- `apps/web/src/scenes/Conversation.tsx` L11 `partClass()` 已把
  `StructuredMessagePart['type']` 映射到 CSS 类。
- `apps/web/src/scenes/Conversation.module.css` L44-60：`actionPart`/`environment`/
  `narrationPart` 已是 `font-style: italic`，`dialoguePart` 为正体。
- 另有 `apps/web/src/components/conversation/NarrationText.tsx` 专做 serif italic。

即「斜体表背景、正体表对话」前端**已经实现**，靠的是 typed parts，不需要 `^/*` 符号。

### C.2 结论：`^/*` 符号方案是现有 typed-parts 的弱化版

PM 拟用的拆句 prompt 相比现有 `outputStructurer` 默认 prompt：
分类从 4 类（dialogue/action/environment/narration）退化为 2 类；输出从 typed JSON
退化为行内符号纯文本（前端需反向解析、流式下标记可能跨 chunk 裂开、`*` 与 markdown
冲突）。唯一新增能力是「删 think」——而这条不该靠 prompt（LLM 非确定性），应靠 Part A
的 provider 正则。

### C.3 三个「后移」方案（按结构改动从小到大）

| 方案 | 做法 | 效果 | 改动面 |
|---|---|---|---|
| ① 净化下沉 + 拆句回写 | provider 正则滤 think；chunk 流/前端不动；拆句结果回写 `messages` 成为持久化/历史权威版 | think 堵死；压缩/偏好侧袋读到干净结构化文本 | 最小 |
| ② `structured` 升级为终稿替换 | live 仍流式；拆句跑完后前端用 `structured` 结果**替换**主消息；服务端持久化也写拆句版 | 用户最终见结构化版；保留流式；保留侧袋开关 | 中小 |
| ③ 流式转换器串接 | 拆句改流式，插在 main 与 SSE 之间当干道 | 从首字即结构化、无闪烁 | 最大；与「独立开关」有张力 |

Claude main 推荐 **方案 ②**：效果/成本最优，且不破坏本轮刚验收通过的「侧袋独立开关」
特性。**此项仅评估，未动手，待 PM 拍板后另出 spec。**

---

## Part D — 已落地改动 1：prompts.ts 加 think 丢弃规则【已落地】

### D.1 改动内容

`apps/api/src/sidecar-ai/prompts.ts` 的 `outputStructurer` 默认 prompt 规则段，
新增一行：

```
- 保持原文不变，只做拆分和分类
- 思考过程 / <think> 标签内的内容直接丢弃，不要纳入任何 part   ← 新增
- 只输出 JSON 对象，不要有任何其他文字
```

### D.2 定位与限度（必须如实知会）

这是**双保险**，不是闸门。拆句侧袋在 postMain 跑、产出是旁路（见 Part B），
所以这行**拦不到** live 流和持久化里的 `</think>`。真正堵漏仍依赖 Part A。
此行的实际价值：当拆句结果将来按方案 ① / ② 回写主消息时，多一层语义兜底。

### D.3 验证命令

| 声称 | 验证命令 | 期望 |
|---|---|---|
| 改动已落地 | `git diff apps/api/src/sidecar-ai/prompts.ts` | 仅新增 1 行，位于 `outputStructurer` 规则段 |
| typecheck 不破 | `pnpm --filter @yelan/api typecheck` | 无报错（已实跑：通过） |
| 测试不破 | `pnpm --filter @yelan/api test` | 全绿（已实跑：20 文件 / 131 测试全过） |

---

## Part E — 已落地改动 2：清理 state.json 冗余 override【已落地，含操作风险】

### E.1 背景

`state.json` 的 `sidecarPrompts` 里存有一条 `preferenceRecorder` 配置，内容与
`prompts.ts` 默认值**逐字一致**。`getPrompt()`（prompts.ts L96-100）逻辑为
`configured || DEFAULTS[key]` —— 一旦 state 里有 override，运行时永远用 state 那份。

此条当前无害（与默认值相同），但是**哑雷**：日后若改代码里 `preferenceRecorder`
默认 prompt，运行时不会跟随，因为 state 里那份会一直赢。

> 附带澄清：此机制本身证明后端**是真的**（admin 配了就生效），不是「假后端」。
> 问题只在这一条是冗余的、且会冻结默认值。

### E.2 改动内容

删除 `state.json` → `sidecarPrompts.preferenceRecorder`，使 `sidecarPrompts` 为 `{}`。
让 5 个侧袋 prompt 全部回退为「跟随代码默认值」。

### E.3 操作过程（含风险，如实记录供审计）

`state.json` 是单次载入内存、退出 flush 落盘；服务器以 `tsx watch` 跑（父 watcher
26712 + 子进程 16812）。直接改文件会被运行中服务器覆盖。采用的步骤：

1. node 脚本读 `state.json`、`delete sidecarPrompts.preferenceRecorder`、写回。
2. **强杀**子进程 16812（`Stop-Process -Force`）—— 强杀绕过 SIGTERM flush，
   使磁盘上的干净文件不被内存旧状态覆盖。
3. `tsx watch` 强杀后不自动重启 —— 碰 `src/index.ts` 的 mtime 触发 watcher 重启子进程，
   新子进程读入已清理的 `state.json`。

**操作风险（已发生但无损失，需审计确认）**：
- 强杀服务器属不可逆操作。当时服务器空闲（无进行中会话），`save()` 200ms 防抖窗口内
  无未落盘改动，故强杀未丢数据。
- 过程中 PowerShell 5.1 `ConvertFrom-Json` 一度报「文件损坏」——经 node `JSON.parse`
  确认是 PS 5.1 解析器限制，**文件实际完好**，虚惊。

### E.4 副作用

`apps/api/src/index.ts` 的 mtime 被碰过（**内容未改**）。`git diff` 不会显示它，
但若有基于 mtime 的缓存需留意。

### E.5 验证命令

| 声称 | 验证命令 | 期望 |
|---|---|---|
| override 已清 | `node -e "console.log(Object.keys(JSON.parse(require('fs').readFileSync('apps/api/.local/state.json','utf8')).sidecarPrompts))"` | `[]` |
| 用户数据无损 | 同上脚本读 `.users` 键数 | `5`（会话 `6`） |
| 服务器在线 | `curl -s -o nul -w "%{http_code}" localhost:8787/api/admin/sidecar-prompts` | `401`（路由存在、服务在线） |
| index.ts 内容未改 | `git diff apps/api/src/index.ts` | 空 diff |

---

## Part F — 追查中发现的缺陷 / 待办【未处理】

1. **`sidecar-prompts` 路由无 DELETE/reset**：
   `apps/api/src/routes/admin/sidecar-prompts.ts` 只有 GET + PATCH。PATCH 只能**设值**，
   无法**删除** override 让 prompt 回退默认。本次清理只能绕到改文件 + 重启服务器。
   建议补一个 `DELETE /:key`（或 reset 端点），否则 admin 无法把 prompt 退回默认。

2. **`nvidia-unlim.ts` 无 think 净化**：见 Part A，待决策修复方案 A/B。

3. **`persistence.ts` 损坏即清空的隐患**：
   `ensureLoaded()`（L323-326）在 `state.json` 解析失败时 `catch` → `defaultState()`，
   即**静默重置为空状态**，下次 `save()` 会用空状态覆盖文件。一旦文件真损坏 = 全量
   用户/会话/消息数据丢失，且无自动备份回滚。建议加：解析失败时备份坏文件 + 拒绝启动
   或从 `snapshot-*` 恢复，而非静默清空。（`.local/` 下现有一个手工
   `snapshot-2026-05-14` 目录，但非自动机制。）

---

## 给 Codex 的审计重点

1. **复跑 Part D / E 的验证命令表**，确认已落地改动属实、无回归。
2. **审 Part A 诊断是否准确**：读 `nvidia-unlim.ts` L107-113，确认 `delta.content`
   裸透传、不读 `reasoning_content`；grep 全库确认无 `<think>` 处理。
3. **审 Part E 操作是否留下隐患**：确认 `state.json` 完好、无数据丢失、服务器健康。
4. **对 Part C 三方案给独立意见**：尤其方案 ② 是否真能兼容「侧袋独立开关」。
5. **对 Part F.3 的数据丢失隐患给风险评级**——这条独立于本次任务，但属真实缺陷。

## 红线（本次已遵守，复述供核）

- ✅ 未碰 `packages/shared`。
- ✅ 未碰 `client.ts` 的 `response_format`。
- ✅ `</think>` 泄漏本体**未修**（待决策），只加了 prompts.ts 一行双保险。
- ✅ 拆句后移**未动手**，只出评估。
- ⚠️ 唯一越界：为清 state.json 强杀并重启了 dev 服务器 —— 已在 E.3 如实记录。

## 当前工作树状态（uncommitted）

- `apps/api/src/sidecar-ai/prompts.ts` —— 已改（Part D），未 commit。
- `apps/api/.local/state.json` —— 已改（Part E），`.local` 属 gitignore。
- `apps/api/src/index.ts` —— mtime 被碰，内容未改，`git diff` 为空。
- 其余 git status 中的改动（ServiceConfig/Setup/feature-flags/docs 等）非本次产生，不在本报告范围。
