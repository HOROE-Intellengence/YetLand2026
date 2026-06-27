# Chat 延迟修复工作报告, 2026-05-21

## 依据

审计报告 `docs/audit/2026-05-21-chat-latency-diagnosis.md`，五轮实测平均完成时间约 77s，中位约 76.8s，最慢一轮 133s。

## 根因回顾

| 根因 | 描述 |
|------|------|
| A: 主路由未隔离 | `LlmRouter` 的 fallback 链把 `env-nvidia` (z-ai/glm-5.1) 和 `horoe-sidecar` 混入主节点候选，admin 选了 Gemini Flash 但实际可能落到 GLM |
| B: 侧袋串行阻塞 | `atmosphereJudge` 挡在 SSE 首包之前，`outputStructurer` 挡在 `done` 之前 |
| C: 侧袋无超时 | `sidecarCall` 的 `fetch()` 没有 timeout，实测飙到 43s/48s |
| D: 回退策略放大延迟 | 主路由顺序重试三个 provider，每个 30s 空闲超时，最坏 90s |

## 修改清单

### P0-1: 主路由角色隔离

**文件**: `apps/api/src/services/llm-api-inventory.ts`、`apps/api/src/llm/create-router.ts`

**改动**:
- 新增 `getMainRouterConfigs()` 函数，仅返回 `mainApiId` 对应的选中主 provider
- `create-router.ts` 改用 `getMainRouterConfigs()` 替代 `getEnabledLlmApiConfigs()`
- 主路由不再包含 sidecar 或 env 提供者，不可用时空数组（fail-closed）

**效果**: admin 选中什么模型，主回复就一定走什么模型。消除静默 GLM 回退和 sidecar-as-main 回退。

---

### P0-2: 实际 Provider 追踪

**文件**: `packages/llm/src/types.ts`、`packages/llm/src/router.ts`、`packages/shared/src/types/chat.ts`、`apps/api/src/pipeline/chat-pipeline.ts`、`apps/api/src/routes/chat.ts`

**改动**:
- `CompletionChunk` 新增 `providerId?` 和 `model?` 字段
- `LlmRouter.stream()` 在每个 provider 输出的 chunk 上打标
- SSE `meta` 事件新增 `mainProviderId` 和 `mainModel` 字段（发送选中值），共享运行时 schema 同步保留这两个字段
- `streamMainLLM` 捕获实际应答的 provider 并 yield
- `recordTurnCost` 接收 `actualProviderId` 并打印 `[cost]` 日志，成本记录使用实际 model 而非选中 model

**效果**: 每次请求可在 SSE meta 看到选中的主 provider/model，在服务器 `[cost]` 日志看到实际应答 provider/model。不再盲猜。

---

### P1-1: 侧袋硬超时

**文件**: `apps/api/src/sidecar-ai/client.ts`、`apps/api/src/sidecar-ai/atmosphere-judge.ts`、`apps/api/src/sidecar-ai/output-structurer.ts`

**改动**:
- `sidecarCall` 内部用 `AbortController` + `setTimeout` 包裹 `fetch()`
- 超时覆盖响应头等待、响应 body 读取与 JSON 解析，不只覆盖 `fetch()` 首段
- 默认超时 5s，支持 `opts.timeoutMs` 覆盖
- `AbortError` 被捕获，返回 `{ ok: false, error: 'sidecar timeout after Xms' }`
- `judgeAtmosphere` 传入 `timeoutMs: 2000`
- `structureOutput` 传入 `timeoutMs: 3000`

**效果**: 侧袋调用最长阻塞时间从无上限降到 2s/3s/5s。43s 的 temperature spike 不会再发生。

---

### P1-2: 结构化不阻塞 done

**文件**: `apps/api/src/routes/chat.ts`

**改动**:
- 主 LLM 输出完成后，立即用正则 `fallbackStructure` 生成降级结构化结果
- AI 结构化和 1500ms 预算赛跑：AI 先到则用 AI 结果；超时则用降级结果 emit `structured` + `done`
- 超时后复用同一个 AI 结构化 promise 收尾，避免重复发起第二次侧袋请求；当前协议暂不补发 `structured:update`

**效果**: `done` 事件至多延迟 1500ms，不再被 structurer 的 48s spike 卡住。

---

### P1-3: SSE 首包不等待温度判定

**文件**: `apps/api/src/routes/chat.ts`

**改动**:
- `resolveTemperature` 从 SSE 外部移入 SSE 回调内部
- SSE 打开后立即 emit `meta`，然后才 await 温度判定
- 温度相关数据（`sidecarBlock`、`system` prompt 拼接）跟随移入 SSE 内部
- 温度无关数据（`profile`、`summary`、`recentHistory`、`systemBase`、`persistUserMessage`）保留在 SSE 外部同步完成

**效果**: 前端在请求发出后立即收到 SSE 连接和 `meta` 事件，不再被 atmosphere judge 挡住首包。温度判定最长等待 2s（受 P1-1 硬超时保护）。

---

## 验证结果

| 项目 | 结果 |
|------|------|
| TypeScript 编译 | 10/10 workspace 通过 (`pnpm -r run typecheck`) |
| 单元/集成测试 | 300/300 通过 (`pnpm -r run test`) |
| `apps/api` 测试 | 228/228 通过（含 SSE smoke、chat pipeline、llm inventory、sidecar client、output structurer） |
| `packages/llm` 测试 | 11/11 通过 |
| `packages/shared` 测试 | 12/12 通过 |

## 追加审计修正

- 修正侧袋 timeout 覆盖范围：timer 现在持续到响应 body 读取和 JSON 解析结束，避免服务端先发 header 后卡 body 时绕过超时。
- 修正结构化预算实现：1500ms 超时后不再重复调用 `structureOrFallback()`，避免慢请求导致双倍侧袋调用。
- 修正 SSE schema：`ChatStreamEventSchema` 现在保留 `mainProviderId` / `mainModel`，前端解析不会静默丢字段。
- 新增测试覆盖主路由 fail-closed、侧袋 body 读取超时、SSE meta provider 字段。

追加验证：

| 项目 | 结果 |
|------|------|
| API targeted tests | 5/5 通过（`sidecar-ai/client.test.ts`、`llm-api-inventory.test.ts`） |
| Shared schema targeted tests | 3/3 通过（`schemas/chat.test.ts`） |
| Full workspace typecheck | 10/10 workspace 通过 |
| Full workspace tests | 300/300 通过 |

## 预期延迟改善

| 阶段 | 修复前（中位） | 修复后（预期） |
|------|---------------|---------------|
| SSE 首包 (meta) | ~8.9s（被 atmosphere judge 阻塞） | <100ms（立即 emit） |
| atmosphere 判定 | ~8.9s（无超时，最高 43s） | ≤2s（超时则 fallback） |
| 主模型应答 | 不可控（可能走 GLM 回退） | 仅选中模型（role-isolated） |
| 结构化 | 3-10s（无超时，最高 48s） | ≤1.5s（超时则 regex fallback） |
| 端到端 (done) | ~76.8s | 预计主模型延迟 + ≤5s 侧袋预算 |

## 已知未处理项（P2，待后续迭代）

- 侧袋任务路由拆分（atmosphereJudge / outputStructurer 独立 task slot）
- 主路由显式 fallback 策略（first-token timeout 8-12s，只回退到显式标记 main-compatible 的 provider）
- `structured:update` 延迟更新事件（需前端配合）
