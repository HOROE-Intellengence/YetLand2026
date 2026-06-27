# 四问题诊断与修复工单 — 2026-05-26

> 交付对象：执行修复的第二个 AI / 工程师。本工单自包含，可冷启动直接施工。
> 范围：4 个线上观察到的运行时缺陷。修复 = 改代码 + 自验收。
> 约束：先读完每个问题的「根因」再动手；不要顺手重构无关代码。

---

## 0. 背景与分诊结论（先读）

四个现象：

1. 氛围判断 AI 没运行，温度显示锁在 3。
2. IF 暗号后温度未调整，只在后台解除了边界限制。
3. 切换账户后本地对话仍可见。
4. 结构拆句 AI 未正常运行（疑似整个侧袋失灵）。

**分诊结论：问题 1 与问题 4 不是"侧袋没配 key"，而是"侧袋活着但被各自的超时/竞速预算系统性掐断"。**

证据来自既有审计 `docs/audit/2026-05-21-chat-latency-diagnosis.md`：

- 该环境 sidecar（`horoe-sidecar / gemini-3.1-flash-lite`）是 ready 的，有 key。
- 实测「结构拆句延迟」= 3.38s / 9.91s / 4.67s（前三轮），而路由只给它 `STRUCTURER_BUDGET_MS = 1500ms`。→ 拆句侧袋每轮都输掉竞速，结果永远是正则降级。
- 实测「pre-main 侧袋到首事件」= 2.84s / 8.90s / 8.08s，而 `judgeAtmosphere` 超时只有 `2000ms`。→ 氛围判断每轮 Abort，温度每轮降级。

> 施工前仍建议 30 秒复核一次：API 日志若出现 `no sidecar API key configured`，说明该环境额外存在"无 key"问题，需补 `SIDECAR_API_KEY` / 后台 `sidecarApiId`；但这不替代下面的预算修复。

问题 2 主要是问题 1 的下游 + 一个产品语义待定。问题 3 是独立的前端隐私缺陷，与本周未提交的 IF 改动无关。

---

## 问题 1 — 氛围判断 AI 未生效，温度锁死在 3

### 现象
前端温度常驻 3，不随对话冷热变化。

### 根因
- `apps/api/src/sidecar-ai/atmosphere-judge.ts:68` — `judgeAtmosphere` 调 `sidecarCallWithSchema(..., { timeoutMs: 2000 })`。实际侧袋延迟 2.8–8.9s，每轮 `AbortError` → `ok:false`。
- `apps/api/src/pipeline/chat-pipeline.ts:91` `resolveTemperature` — 侧袋失败即走 `fallbackTemperature`。
- `apps/api/src/pipeline/chat-pipeline.ts:84` `fallbackTemperature` — 逻辑是"向 3 回归"（>3 减一、<3 加一、==3 返回 3）。**一旦落到 3 就自锁**，因为降级路径自身永远把温度拉回 3。
- 前端无 bug：`apps/web/src/hooks/useChat.ts:89` 正确消费 `atmosphere` 事件，显示的 3 忠实反映后端每轮返回 3。

### 工作建议
1. 放宽 `judgeAtmosphere` 超时，与主侧袋调用对齐（参考 `client.ts:30` 的 `SIDECAR_DEFAULT_TIMEOUT_MS = 5000`）。把 `2000` 提到 `5000`（或显式常量），让正常延迟的侧袋能完成。
2. 改进降级语义：`fallbackTemperature` 不应无脑回归 3。侧袋失败时应**保持上一轮温度**（`getCurrentTemperature` 已能取上次值），而不是把历史热度清零。
3. 对超时与 schema 失败分别打点（区别于"无 key"），避免静默降级，便于后续量化命中率。

### 验收标准
- [ ] 正常对话连续 5 轮，`atmosphere` SSE 事件温度至少出现一次 ≠ 3，且方向合理（亲密升温、冷场降温）。
- [ ] 人为把侧袋延迟设为 ~3s：`judgeAtmosphere` 不再每轮 Abort（放宽后能成功）。
- [ ] 侧袋真失败（超时/无 key）时，温度**保持上一轮值**，而非掉回 3。
- [ ] 成功轮 `temperatureLogs[sessionId].values` 追加了判定值（`atmosphere-judge.ts:71 recordTemperature` 被调用）。
- [ ] 新增/更新单测：`fallbackTemperature` 在 `current=3` 且存在历史热度时，不再强制返回 3。
- [ ] 日志能区分三种降级原因：`no key` / `timeout` / `schema invalid`。

---

## 问题 2 — IF 暗号后只解除边界，温度不动

### 现象
说出暗号后，后台边界放开（B 值上升），但温度毫无变化。

### 根因
- `apps/api/src/services/if-unlock.ts:59` `activateIf` — 命中暗号只做两件事：抬 `narrativeBoundary`（= 解除边界）、把 session 翻成 `mode='if'`。**完全不碰温度**。
- 温度唯一来源是氛围判断 AI。IF 信号经 `chat-pipeline.ts:107-113` 的 `codeMatched`/`ifActive` 喂给 `judgeAtmosphere`。
- `apps/api/src/sidecar-ai/atmosphere-judge.ts:38` 的 prompt 明确写：暗号"是当前上下文信号，**不是温度下限**"——设计上暗号本就不强行抬温。
- `fallbackTemperature`（`chat-pipeline.ts:84`）**根本不读 `ifUnlock`**。
- 因此：氛围 AI 一停（问题 1），暗号对温度零影响，只剩边界变化被观察到。

### 工作建议
1. **先修问题 1**——这是主因，氛围 AI 恢复后暗号才可能经它影响温度。
2. **产品决策（需确认后再实现）**：IF 暗号是否应有"可感的即时升温"？
   - 若需要：在降级路径给一个温度地板，例如命中暗号当轮 `temperature = max(current, N)`，保证侧袋挂掉时暗号也有反馈；同时可考虑放宽 prompt 中"不是温度下限"的表述。
   - 若不需要（保持现状设计）：仅修问题 1，并在 UI 文案上说明"边界已解除，温度由氛围判定"，避免用户误解为 bug。

### 验收标准
- [ ] 产品语义已书面确认：暗号 = 仅解除边界，还是 = 解除边界 + 温度地板。
- [ ] 边界确实抬升：命中后 `users[userId].narrativeBoundary = max(原值, 暗号 boundary)`，后续轮 `effectiveBoundary` 生效。
- [ ] 若选"温度地板"：命中暗号当轮，即使侧袋全降级，`atmosphere` 温度 ≥ 约定地板；未命中轮不受影响。
- [ ] 回归：暗号边界解除是 user 级永久、IF 前置卡是 session 级（`apps/api/src/services/if-multiaccount.test.ts` 跑通，无回归）。

---

## 问题 3 — 切换账户后本地对话仍可见（跨账户泄露）

### 现象
账户 A 登出、账户 B 登录同一浏览器进入同一角色，仍能看到 A 的历史对话。

### 根因
- `apps/web/src/chat/local-history.ts:68` `storageKey = 'yelan.chatSession.' + characterId` — **只按角色 ID，不含用户 ID**。
- `apps/web/src/scenes/Conversation.tsx:95` `loadLocalChat(character.id)` — 进对话即按角色加载，与当前登录者无关。
- `apps/web/src/api/auth.ts:126` `logout()` 仅 `setToken(null)`；`apps/web/src/api/client.ts:21` `setToken` 仅删 `yelan.token`。
- `apps/web/src/components/drawer/panels/YouPanel.tsx:282` `handleLogout` 不清 `yelan.chatSession.*`。
- **同类隐患（一并修）**：记忆 Dexie 库与 `apps/web/src/memory/sync.ts:10` 的 `yelan.memory.since` 也是浏览器级、不按用户隔离 → 上一账户的偏好/事件记忆同样残留并可能被新账户同步混用。

### 工作建议
1. 存储键加用户维度：`yelan.chatSession.${userId}.${characterId}`；或在快照里写 `ownerUserId`，`loadLocalChat` 校验不匹配则返回 `null`（防御换号未登出场景）。
2. 登录成功（`setToken` 设新 token）与登出（`logout`）时清理上一身份的本地态：`yelan.chatSession.*`、Dexie `memoryDb`、`yelan.memory.since`。
3. 建一个统一的 `clearLocalUserData()`，在所有身份切换入口调用，避免遗漏。当前需覆盖的入口（`apps/web/src/api/auth.ts`）：`verifyOtp`、`loginWithEmail`、`loginWithPassword`、`registerWithEmail`、`logout`、`deleteMyAccount`、`revokeAllMySessions`。

### 验收标准
- [ ] A 聊几轮 → 登出 → B 登录进同一角色：看不到 A 的任何消息（仅开场白或空）。
- [ ] 不经登出、直接换号登录（覆盖旧 token）也不串号（键含 userId，或快照 ownerUserId 校验拦截）。
- [ ] B 登录后 Dexie `preferences/events` 不含 A 的条目；`yelan.memory.since` 已重置，B 能全量拉到自己的服务端记忆。
- [ ] 同一账户重新登录：自己的对话/记忆能正常恢复（不能误删自己的）。
- [ ] 登出后 localStorage 不存在跨用户可读的 `yelan.chatSession.*`。
- [ ] 新增单测：`loadLocalChat` 在 ownerUserId / 键不匹配时返回 `null`。

---

## 问题 4 — 结构拆句 AI 未生效（常年走正则降级）

### 现象
助手输出始终是粗糙的整句，全部 `narration` 类型，看不到台词/动作/环境的结构化拆分。

### 根因
- `apps/api/src/routes/chat.ts:177` — 路由给拆句只留 `STRUCTURER_BUDGET_MS = 1500`，用 `Promise.race` 抢；超时即发 `fallbackStructure`（纯正则，全标 `narration`）。
- `apps/api/src/sidecar-ai/output-structurer.ts:28` — `structureOutput` 内部 `sidecarCall` 用 `timeoutMs: 3000`。
- **1500ms 路由预算 < 3000ms 侧袋超时**，且实测拆句延迟 3.4–9.9s（见 §0）。→ 健康的拆句侧袋**永远赢不了竞速**，每次都被丢弃、显示正则降级。
- `apps/api/src/routes/chat.ts:189` `void aiPartsPromise.catch()` 把超出预算的 AI 结果静默吞掉，无可观测性。
- 若该环境侧袋无 key：`structureOrFallback`（`chat-pipeline.ts:171`）直接返回 null，也走降级（叠加因素）。

### 工作建议
1. 协调预算与超时：让路由预算 ≥ 侧袋超时（如预算 3000–3500ms，侧袋 3000ms），二者不能交叉。注意这会增加用户可见延迟——结合 `2026-05-21-chat-latency-diagnosis.md`，拆句在用户关键路径上，需权衡：可考虑给侧袋更快的模型，或评估"先发正则、AI 结果异步补发/下轮替换"的方案。
2. 给被预算丢弃的拆句加日志计数，便于量化 AI 拆句命中率。
3. 配置侧确认侧袋 key（同 §0 复核）。

### 验收标准
- [ ] 代码层面 `STRUCTURER_BUDGET_MS ≥ structureOutput 内部 timeout`（或文档化二者关系并加测试钉住，防回归交叉）。
- [ ] 正常对话连续 5 轮，`structured` 事件 `parts` 至少出现 `narration` 以外的类型（台词/动作/环境），证明 AI 拆句生效。
- [ ] 慢侧袋场景（延迟设 ~2s）：仍能拿到 AI 拆句结果，而非降级。
- [ ] 侧袋真失败（超时/无 key）：`fallbackStructure` 正常出 `narration` 片段，前端不崩。
- [ ] 被预算丢弃的拆句有日志计数，可评估命中率。
- [ ] 延迟回归：拆句修复后，端到端 total-to-done 不显著恶化（与 `2026-05-21` 基线对比，记录新数据）。

---

## 全局任务清单

| # | 任务 | 文件 | 类型 |
| --- | --- | --- | --- |
| 1 | 放宽 `judgeAtmosphere` 超时至 5000ms | `apps/api/src/sidecar-ai/atmosphere-judge.ts:68` | 后端 |
| 2 | `fallbackTemperature` 改为"保持上一轮值"而非回归 3 | `apps/api/src/pipeline/chat-pipeline.ts:84` | 后端 |
| 3 | 侧袋降级原因分类打点（no-key / timeout / schema） | `chat-pipeline.ts` / `client.ts` | 后端 |
| 4 | 确认 IF 暗号温度语义 → 视决策加温度地板 | `if-unlock.ts` / `chat-pipeline.ts` | 产品+后端 |
| 5 | 本地对话存储键加 userId / ownerUserId 校验 | `apps/web/src/chat/local-history.ts` | 前端 |
| 6 | 统一 `clearLocalUserData()` 并接入 7 个身份切换入口 | `apps/web/src/api/auth.ts` 等 | 前端 |
| 7 | 协调拆句路由预算与侧袋超时 + 丢弃打点 | `apps/api/src/routes/chat.ts:177` | 后端 |

## 不在本次范围
- 侧袋/主路由的整体延迟优化（已有独立审计 `2026-05-21-chat-latency-*`）。
- IF 暗号匹配硬化、前置卡优先级（本周已改并有测试覆盖，勿动）。
- 主 LLM 路由 fallback 链改造。

## 关键参考
- `docs/audit/2026-05-21-chat-latency-diagnosis.md` — 侧袋延迟实测数据（本工单分诊依据）。
- `apps/api/src/sidecar-ai/orchestrator.ts` — 五侧袋编排与开关（默认全启用，本次无需改）。
