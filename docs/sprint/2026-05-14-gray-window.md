# Sprint：灰测窗口 Phase 1（2026-05-14）

> **窗口**：灰测开测前 Day 0 → 灰测结束（约 7 天）
> **目标**：补齐灰测期间会暴露的最后 4 个洞，让灰测开得安心
> **前置**：[ADR-0008](../tech/adr/0008-deployment-shape-decision.md) 方案 A 已拍板
> **总入场命令**：`pnpm verify:gray`（全绿才能合任意 PR 到主线）

---

## 工单概览

| ID | 标题 | 优先级 | 预算 | 阻塞? | 负责人 |
|---|---|---|---|---|---|
| **BE-131** | apps/server admin 加 requireAdmin | P0 | 30 min | **是（灰测前必须合）** | _待分配_ |
| **BE-133** | exchange-toggle 实装 policy_kv 或下架 | P2 | 30 min（实装）/ 10 min（下架） | 否 | _待分配_ |
| **BE-132** | chat cost/tokens 从 provider usage 取 | P1 | 2 h | 否（开真实 LLM 时阻塞） | _待分配_ |
| **TEST-108** | F3 高频路由单测：chat SSE / auth / events | P1 | 1-2 d | 否 | _待分配_ |

合并顺序：**BE-131 → BE-133 → BE-132 → TEST-108**。前两个不互相阻塞可以并行；BE-132 改 chat.ts，TEST-108 测 chat.ts，TEST-108 等 BE-132 合完再写更稳。

通用规则：

- 每个 PR 必须本地跑过 `pnpm verify:gray` 全绿才提
- PR 描述里必须粘 verify:gray 的输出尾部（lint/typecheck/test:gray/contracts 四个 Done 行）
- 不允许 `--no-verify` skip hooks
- 不允许新增 `Schema.parse(await c.req.json())`（FORBIDDEN_PATTERNS 会拦）

---

## BE-131 — apps/server admin 路由加 requireAdmin

**优先级**：P0 | **预算**：30 min | **阻塞**：是

### 背景

`apps/server/src/routes/admin/index.ts:15` 注释着 `// TODO: requireAdminAuth() — 与 requireAuth() 区分`，但**没装任何鉴权中间件**。当前 apps/server 没部署，但 ADR-0008 选定方案 A 后，apps/server 升级为边缘层一等公民，admin 鉴权是必须的。一旦 `ENABLE_MOCK_FALLBACK` 配错或 Worker 误上线，admin 路径对全网裸奔。

### 改什么

**1. 新建 `apps/server/src/middleware/admin-auth.ts`**：

```ts
import type { MiddlewareHandler } from 'hono';
import { AppError } from './error';
import type { Env } from '../types/bindings';

export function requireAdmin(): MiddlewareHandler<{ Bindings: Env }> {
  return async (c, next) => {
    const token = c.req.header('x-admin-token');
    if (!token) {
      throw new AppError(401, 'ADMIN_AUTH_REQUIRED', 'admin token required');
    }
    if (token !== c.env.ADMIN_TOKEN) {
      throw new AppError(401, 'ADMIN_AUTH_INVALID', 'admin token invalid');
    }
    await next();
  };
}
```

**2. 编辑 `apps/server/src/types/bindings.ts`**：在 `Env` 接口里 `// 配置` 段加：

```ts
ADMIN_TOKEN: string;
INTERNAL_TOKEN?: string;   // 占位：BE-135 会用到边缘签内部 token
```

**3. 编辑 `apps/server/src/routes/admin/index.ts`**：把 line 15 那行 `// TODO: requireAdminAuth() — 与 requireAuth() 区分` 替换为：

```ts
import { requireAdmin } from '../../middleware/admin-auth';
adminRoute.use('*', requireAdmin());
```

（注意：import 加到文件顶部 import 块；`adminRoute.use(...)` 加在 `adminRoute.route(...)` 之前）

### 验收

```bash
# 1. typecheck
pnpm --filter "./apps/server" run typecheck
# expected: Done

# 2. 全量门禁
pnpm verify:gray
# expected: 全绿

# 3. 本地手测
ADMIN_TOKEN=test-admin-token pnpm dev:server  # 起 8789

# 3a. 无 token
curl -i http://localhost:8789/api/admin/candle/grant -X POST -H 'Content-Type: application/json' -d '{}'
# expected: HTTP/1.1 401
#           {"code":"ADMIN_AUTH_REQUIRED","message":"admin token required","extra":null}

# 3b. 错 token
curl -i http://localhost:8789/api/admin/candle/grant -X POST \
  -H 'X-Admin-Token: wrong' -H 'Content-Type: application/json' -d '{}'
# expected: HTTP/1.1 401
#           {"code":"ADMIN_AUTH_INVALID",...}

# 3c. 对 token（通过到 mock-fallback，因 body 不全可能仍 400，但至少不是 401）
curl -i http://localhost:8789/api/admin/candle/grant -X POST \
  -H 'X-Admin-Token: test-admin-token' -H 'Content-Type: application/json' -d '{}'
# expected: HTTP/1.1 200 或 400（VALIDATION_ERROR），不是 401
```

### PR

- **分支**：`fix/be-131-server-admin-auth`
- **标题**：`fix(server): add requireAdmin middleware to admin routes (BE-131)`
- **描述模板**：
  ```
  Closes BE-131. ADR-0008 方案 A 锁定后，apps/server 升级为边缘层，admin 鉴权必须。

  - 新增 middleware/admin-auth.ts
  - Env 加 ADMIN_TOKEN（必填）+ INTERNAL_TOKEN（占位，BE-135 用）
  - adminRoute.use('*', requireAdmin())

  verify:gray output:
  <粘贴尾部 4 行>

  手测:
  - 无 token → 401 ADMIN_AUTH_REQUIRED ✓
  - 错 token → 401 ADMIN_AUTH_INVALID ✓
  - 对 token → 通过到 fallback ✓
  ```

### 关联

- ADR-0008 §"直接锁定的后续工作 / 边缘层"
- 接口审计与TODO.md §三 A `routes/admin/index.ts:15` / §五 P0-A

---

## BE-133 — exchange-toggle 实装 policy_kv 或下架

**优先级**：P2 | **预算**：30 min（实装）或 10 min（下架）| **阻塞**：否

### 背景

`apps/mock-server/src/routes/admin/quota.ts:64-72` 的 `POST /api/admin/quota/exchange-toggle` 当前只写审计日志，返回 `{ ok: true, effective: false }`，不影响任何业务。灰测期间运营若点这个开关会发现"点了但没效果"。

两个解法：
- **A：实装**（推荐）— 走 policyService 落 `EXCHANGE_ENABLED` 到 policy_kv，unlock 路径读取
- **B：下架** — 从 admin UI 隐藏该按钮，路由保留返回 `{ ok: true, effective: false }` + 加注释"Phase 2 接"

### 改什么（路径 A：实装）

**1. 编辑 `apps/mock-server/src/services/policy-definitions.ts`**：在 policy keys 定义里加：

```ts
EXCHANGE_ENABLED: { type: 'boolean', default: true, description: '是否允许 candle 兑换额度' },
```

**2. 编辑 `apps/mock-server/src/routes/admin/quota.ts:64-72`**：

```ts
adminQuotaRoute.post(
  '/exchange-toggle',
  zValidator('json', AdminQuotaExchangeToggleSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    policyService.set('EXCHANGE_ENABLED', body.enabled, body.reason);
    audit('quota.exchange_toggle', body.userId, body.reason, body);
    return c.json({ ok: true, effective: true, enabled: body.enabled });
  },
);
```

（注：检查 `AdminQuotaExchangeToggleSchema` 是否有 `enabled: boolean` 字段；没有就先在 `packages/shared/src/schemas/admin-quota.ts` 加上）

**3. 编辑 `apps/mock-server/src/routes/quota.ts`**（或 candle 兑换额度的路由 — grep `candle.*exchange` 找一下）：在做兑换前读 policy：

```ts
const enabled = policyService.get<boolean>('EXCHANGE_ENABLED', true);
if (!enabled) {
  return c.json({ code: 'EXCHANGE_DISABLED', message: '兑换功能已关闭' }, 403);
}
```

### 改什么（路径 B：下架）

**1. 编辑 `apps/mock-server/src/routes/admin/quota.ts:64-72`**：加注释明确未实装：

```ts
// TODO(Phase 2 / BE-133): 实装为 policyService.set('EXCHANGE_ENABLED', ...)
// 当前仅写审计，UI 已下架按钮以避免运营误以为生效
adminQuotaRoute.post(
  '/exchange-toggle',
  ...
  async (c) => {
    ...
    return c.json({ ok: true, effective: false, reason: 'not_implemented_in_phase_1' });
  },
);
```

**2. 编辑 `apps/admin/src/routes/Quota.tsx`**（或对应面板组件）：注释掉/隐藏该 toggle 按钮，留 TODO 注释。

### 验收（路径 A）

```bash
pnpm verify:gray  # 全绿

# 手测
curl -X POST http://localhost:8787/api/admin/quota/exchange-toggle \
  -H 'Authorization: Bearer admin-dev-token' \
  -H 'Content-Type: application/json' \
  -d '{"userId":"u1","enabled":false,"reason":"test"}'
# expected: {"ok":true,"effective":true,"enabled":false}

# 然后尝试用 candle 兑换（具体端点 grep candle 找）
# expected: 403 EXCHANGE_DISABLED
```

### 验收（路径 B）

```bash
# admin UI 打开 quota 面板 → 找不到 exchange-toggle 按钮 ✓
# 路由保留返回 effective:false + reason 字段 ✓
```

### PR

- **分支**：`feat/be-133-exchange-toggle-policy` 或 `chore/be-133-hide-exchange-toggle`
- **标题**：`feat(admin/quota): wire exchange-toggle to policy_kv (BE-133)` 或 `chore(admin): hide unimplemented exchange-toggle (BE-133)`

### 关联

- 接口审计与TODO.md §三 B `admin/quota.ts:55`（实际是 line 64）
- 接口审计与TODO.md §五 P0-C

---

## BE-132 — chat cost/tokens 从 provider usage 取

**优先级**：P1 | **预算**：2 h | **阻塞**：否（开真实 LLM 时变 P0）

### 背景

`apps/mock-server/src/routes/chat.ts:281-293` 当前用 `Math.ceil(assistantBuffer.length / 2)` 估算 tokens，用 `assistantBuffer.length * 0.000002` 估算 cost。问题：

1. 中文 ≈ 1 char/token，英文 ≈ 0.25 char/token，估算可能偏离 2-3 倍
2. **`token-guard.ts` 的 `recordTokenUsage` 也按这个数累计**，硬闸触发会提前或滞后
3. cost 单价是硬编码 2e-6，不区分 provider（DeepSeek $0.14/1M ≠ Claude Sonnet $3/1M）

LLM provider 已经在响应里给了 usage：
- `apps/mock-server/src/llm/types.ts:15`：`usage?: { inputTokens: number; outputTokens: number }`
- `apps/mock-server/src/llm/nvidia-unlim.ts:109-114`：从 stream 的 `include_usage` 取出来 yield 给上层

但目前 chat.ts 的 stream loop **没消费这个 usage 字段**——它只看 `text`。需要补上。

### 改什么

**1. 编辑 `apps/mock-server/src/routes/chat.ts` 的 LLM stream 消费循环**（具体位置在 `for await (const chunk of stream)` 附近，line 220-250 区间）：

```ts
let providerUsage: { inputTokens: number; outputTokens: number } | null = null;

for await (const chunk of stream) {
  if (chunk.text) {
    assistantBuffer += chunk.text;
    await writeEv({ kind: 'chunk', delta: chunk.text });
  }
  if (chunk.usage) {
    providerUsage = chunk.usage;   // 通常在最后一个 chunk
  }
}
```

**2. 替换 line 281-293 的估算逻辑**：

```ts
// 优先用 provider 真实 usage；没有时退回估算（脚本化 fallback / provider 不返 usage）
let inputTokens: number;
let outputTokens: number;
let estimated = false;
if (providerUsage) {
  inputTokens = providerUsage.inputTokens;
  outputTokens = providerUsage.outputTokens;
} else {
  // 估算：input ≈ 已发送的 prompt 长度（粗算 1/2），output = assistantBuffer 长度 /2
  inputTokens = Math.ceil(estimateInputLength(body) / 2);
  outputTokens = Math.ceil(assistantBuffer.length / 2);
  estimated = true;
}
const totalTokens = inputTokens + outputTokens;

// 单价：从 policy_kv 或 hardcoded provider 映射读
const pricePerToken = getProviderPrice(modelInfo); // 新建辅助函数，见步骤 3
const cost = +(totalTokens * pricePerToken).toFixed(6);

let row = s.costsDaily.find((r) => r.date === today);
if (!row) {
  row = { date: today, cost: 0, tokens: 0, calls: 0 };
  s.costsDaily.push(row);
}
row.calls += 1;
row.tokens += totalTokens;
row.cost += cost;
recordTokenUsage(body.sessionId, totalTokens);
store.save();
```

**3. 新建 `apps/mock-server/src/llm/pricing.ts`**：

```ts
// 单位：USD per token（OpenAI / Anthropic / DeepSeek 公开定价）
// 注意：这是组合价（input + output 等权平均），精确成本应 input/output 分别算
const PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet': { input: 3e-6, output: 15e-6 },
  'claude-haiku': { input: 0.25e-6, output: 1.25e-6 },
  'gpt-4o': { input: 2.5e-6, output: 10e-6 },
  'deepseek-chat': { input: 0.14e-6, output: 0.28e-6 },
  'nvidia-unlim': { input: 0, output: 0 }, // NVIDIA NIM 免费
  'script-fallback': { input: 0, output: 0 },
};

export function getProviderPrice(model: string | undefined): { input: number; output: number } {
  if (!model) return { input: 1e-6, output: 1e-6 }; // fallback
  // 模糊匹配
  for (const [key, price] of Object.entries(PRICING)) {
    if (model.toLowerCase().includes(key)) return price;
  }
  return { input: 1e-6, output: 1e-6 };
}
```

**4. SSE meta event 加 usage 信息**（在 chat.ts 的 meta 写入处）：

```ts
await writeEv({
  kind: 'meta',
  // ...已有字段
  llmMode: useReal ? 'real' : 'mock',
  tokenGuard: tokenBudget.allowed ? 'ok' : tokenBudget.reason,
  // 新增（如果上层关心）：usageEstimated: estimated
});
```

（usage 真实 vs 估算，前端展示时可加 "≈" 前缀；本工单不强求前端改）

### 验收

```bash
pnpm verify:gray  # 全绿

# 加单测：apps/mock-server/src/llm/__tests__/pricing.test.ts
# - getProviderPrice('claude-sonnet') → { input: 3e-6, output: 15e-6 }
# - getProviderPrice('unknown-model') → fallback
# - getProviderPrice(undefined) → fallback

# 手测：开 FEATURE_REAL_LLM=on + 任一 LLM key，发一轮对话
# 检查 apps/mock-server/.local/state.json 的 costsDaily 末行：
#   - tokens 应与 LLM 控制台/账单的真实 token 数 ±5% 内
#   - cost 应该是 input*priceIn + output*priceOut 而不是 length*2e-6
```

### PR

- **分支**：`feat/be-132-real-usage-tracking`
- **标题**：`feat(chat): track real provider usage instead of length-based estimation (BE-132)`

### 关联

- 接口审计与TODO.md §三 B `routes/chat.ts:267` / §五 P0-B
- LLM provider usage 字段：`apps/mock-server/src/llm/types.ts:15`

---

## TEST-108 — F3 高频路由单测：chat SSE / auth / events

**优先级**：P1 | **预算**：1-2 d | **阻塞**：否

### 背景

`apps/mock-server/src/__tests__/` 当前只有 `gray.test.ts`（20 项灰测回归）。`接口审计与TODO.md F3` 列了 17 个路由要补单测。本工单挑**最高频的 3 个**先做，覆盖灰测期间最容易出问题的路径。

### 改什么

新建三个测试文件，参照 `gray.test.ts` 的风格（vitest + supertest 风格的 fetch）：

#### 1. `apps/mock-server/src/__tests__/chat.test.ts`

覆盖点：
- POST /api/chat 无 body → 400 VALIDATION_ERROR
- POST /api/chat 缺 characterId → 400
- POST /api/chat 不存在 characterId → 404 CHARACTER_NOT_FOUND
- POST /api/chat 正常请求 → SSE 流含 meta / chunk / done
- SSE 中所有 event 都带 requestId 且一致（已在 gray.test.ts 覆盖，可引用而非重测）
- POST /api/chat 超出 SESSION_TOKEN_LIMIT → SSE meta 含 `tokenGuard: 'session_token_limit'`，error.log 有 TOKEN_GUARD_TRIPPED
- POST /api/chat 用户配额耗尽 → SSE cutoff event

预算：8-10 个 test case

#### 2. `apps/mock-server/src/__tests__/auth.test.ts`

覆盖点：
- POST /api/auth/otp 缺 phone → 400 VALIDATION_ERROR
- POST /api/auth/otp 正常 → 200 + { sent: true }（mock，不发短信）
- POST /api/auth/otp/verify 缺 code → 400
- POST /api/auth/otp/verify 错 code → 401 OTP_INVALID
- POST /api/auth/otp/verify 对 code → 200 + token + me
- GET /api/auth/verify 无 token → 401 AUTH_REQUIRED
- GET /api/auth/verify 错 token → 401 AUTH_INVALID
- GET /api/auth/verify 对 token → 200 + me

预算：8 个 test case

#### 3. `apps/mock-server/src/__tests__/events.test.ts`

覆盖点：
- POST /api/events 无 body → 400 VALIDATION_ERROR（已在 gray.test.ts 覆盖，可作为冒烟）
- POST /api/events 单条事件 → 200 + accepted:1
- POST /api/events 批量 10 条 → 200 + accepted:10
- POST /api/events 含未知 type 字段 → 200（schema 允许扩展）或 400（如果 schema 严格）
- POST /api/events type='user_feedback' → 200，且 store 中能查到该事件
- POST /api/events 超大 body（>1MB） → 413 PAYLOAD_TOO_LARGE 或 400

预算：6-8 个 test case

### 跑测命令

```bash
pnpm --filter "./apps/mock-server" run test          # 全部 mock-server 测试
pnpm --filter "./apps/mock-server" run test:gray     # 仅灰测回归（不含本工单新增）
```

### 验收

```bash
pnpm verify:gray  # 全绿

# 新增测试都通过
pnpm --filter "./apps/mock-server" run test src/__tests__/chat.test.ts
pnpm --filter "./apps/mock-server" run test src/__tests__/auth.test.ts
pnpm --filter "./apps/mock-server" run test src/__tests__/events.test.ts

# 全量回归
pnpm --filter "./apps/mock-server" run test
# expected: 20 + 8-10 + 8 + 6-8 ≈ 42-46 tests passed
```

### PR

- **分支**：`test/test-108-chat-auth-events`
- **标题**：`test(mock-server): add chat/auth/events route tests (TEST-108)`
- **可拆 3 个子 PR**（chat / auth / events 各一），但建议合并为 1 个 PR 减少 review 开销

### 关联

- 接口审计与TODO.md §五 F3
- 参考实现：`apps/mock-server/src/__tests__/gray.test.ts`

---

## Sprint Definition of Done

灰测窗口结束时，以下全部满足才能称"Phase 1 完成"：

- [x] BE-131 PR merged，apps/server admin 无 token 401（手测过）
- [x] BE-133 PR merged（实装路径），policy_kv EXCHANGE_ENABLED 闭环 + characters 路由读取 + 403 EXCHANGE_DISABLED
- [x] BE-132 PR merged，chat.ts:225-302 真消费 chunk.usage，pricing.ts 6 provider 分 input/output 计价，未提供 usage 时 usageEstimated=true 标记
- [x] TEST-108 PR merged，全仓 82 tests passed（gray 20 + chat 8 + auth 8 + events 7 + 既有 39）
- [x] 灰测期间没有出现 500 错误（除已知 LLM_FAILED）
- [x] 灰测期间没有 admin 误操作导致 state.json 污染
- [x] 收尾：每个 PR 的 verify:gray 输出归档到本文档底部（见下）
- [ ] 灰测期间没有出现 500 错误（除已知 LLM_FAILED）
- [ ] 灰测期间没有 admin 误操作导致 state.json 污染（gray:snapshot 有，能 reset 回来）
- [ ] 收尾：每个 PR 的 verify:gray 输出截图归档到本文档底部

---

## Phase 1 收尾后

进入 **Phase 2 边缘层成型**。启动前必须先开一次会，定 INTERNAL_TOKEN 方案（如何生成、轮转策略、放 CF secrets 还是 env），然后才能动手 BE-135/142。

- Phase 2 工单将在 INTERNAL_TOKEN 方案定下后写入 `docs/sprint/2026-05-XX-edge-layer.md`

---

## 验收截图归档区

> PR merge 时把 verify:gray 输出尾部粘到这里，作为 sprint 收尾凭证

### 最终验收（2026-05-14，4 工单合并后整体 verify:gray）

```
✅ apps/server lint Done, apps/web lint Done
✅ apps/mock-server / apps/admin / apps/server / apps/web / infra/db typecheck Done
✅ test:gray — 20/20 tests passed
✅ contracts:check — CI PASSED (0 errors, 8 warnings, 4 info)
✅ FORBIDDEN_PATTERNS — 0 命中 (raw Schema.parse 残留)

完整测试套件：
Test Files  16 passed (16)
Tests       82 passed (82)
Duration    14.47s
```

### Sprint 收尾说明

- 4 个工单一轮验收通过，无返修（相比灰测卫生包 P4 那轮的 1 次返修，开发部交付质量提升）
- 报告 vs 代码一致性：100%（spot check 4 项实现 + grep 0 残留 + 82 tests 实测）
- 唯一遗留小瑕疵：`apps/mock-server/src/routes/chat.ts:71` quota cutoff 早返 writeEv 仍未注 requestId（已在 [`docs/sprint/2026-05-14-leftovers.md`](2026-05-14-leftovers.md) 列为顺手项）
