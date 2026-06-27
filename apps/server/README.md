# apps/server — Cloudflare Workers 后端

> **状态：暂缓 (Phase 1 W5+)**
>
> 当前生产路线是 `apps/api`（Node + Hono + Docker 部署，前身 apps/mock-server）。
>
> 本目录是 Cloudflare Workers 路线（Hono + CF Workers + Postgres + Redis + KV），
> 接口签名与 apps/api 1:1 对齐。当前阶段仅保留架构占位和接口 stub，
> 不作为当前质量门槛。stub 代码（router/pipeline/prompts 等）属于战略保留，
> 不应被判定为烂尾或冗余。
>
> ## ⚠️ 上线前必读：dev-mode 安全/财务地雷
>
> 2026-05 重构后，`src/services/auth.ts`、`src/services/billing.ts`、
> `src/middleware/auth.ts` 的函数从空 stub 改写成了"看起来像实现"的 dev-mode 占位。
> 函数签名完整、有合理返回值，**但实际行为是危险的占位**：
>
> | 函数 | dev-mode 行为 | 上生产的后果 |
> |---|---|---|
> | `auth.verifyOtp` | 接受任意 6 位验证码 | 任意人冒充任意手机号 |
> | `auth.createSession` | 明文 `yelan_<userId>` token | 知道 userId 就能伪造 token |
> | `middleware/auth.userIdFromToken` | 只校验前缀和长度 | 同上 |
> | `billing.consumeQuota` | 永远返回 `{ok:true}` | 无限免费聊天，财务黑洞 |
> | `billing.grantCandle` | 假成功无写入 | 充值不入账 |
> | `billing.getCandleBalance` | 永远返回 0 | 用户余额显示假数 |
>
> 这些文件顶部都有 `⚠️ DEV-MODE ONLY` 横幅警告。**在所有 `TODO(security)`
> 和 `TODO(billing)` 标签清空之前，严禁将 apps/server 切为生产入口**。
> 用 `grep -r "TODO(security)\\|TODO(billing)" apps/server/src` 检查清单。
>
> 本地需要从“新后端入口”完整跑通产品时，用根目录 `pnpm dev:server`。
> 该命令会启动/复用 `apps/api`，再把 `apps/server` 开在 `8789`，
> 并通过 `ENABLE_MOCK_FALLBACK=true` 把 `/api/*`、`/admin`、`/admin-legacy`
> 和 `/assets/*` 代理到 apps/api。

## 启用时机

- Phase 1 W5+：apps/api 稳定运行后，按需将路由逐条迁移到 Workers
- 届时 pipeline / llm / prompts 等共享逻辑从 apps/api 收敛到 `packages/` 下

## 本地联动模式

| 命令 | 行为 |
|---|---|
| `pnpm dev:server` | 推荐联调入口：apps/api `8787` + apps/server `8789`，新后端代理旧完整功能 |
| `pnpm dev:server:raw` | 仅启动 Workers server stub，用于检查新后端自身骨架 |

联动模式只在本地开发显式开启，不改变生产边界。生产要上 Workers 时仍应逐条迁移业务实现，而不是把 apps/api 作为生产依赖。

### 联动模式风险边界

- 不得在生产环境设置 `ENABLE_MOCK_FALLBACK=true` 或 `MOCK_SERVER_BASE` 指向内网 apps/api。
- 该代理桥会转发鉴权头、请求体和 SSE 响应，测试部必须覆盖 auth、admin 写操作、SSE、错误码、CORS 与大响应。
- 当前只做过冒烟验证：`/health`、`/admin`、`/api/admin/characters`、`/api/chat`。它不是完整 E2E 证明。
- 发现接口在 Workers runtime 下行为异常时，优先补真实 server 实现；不要继续扩大 fallback 规则。

## 接口对照

所有 `/api/*` 路由签名与 `apps/api/src/routes/` 一一对应。
差异只在实现层：apps/api 用 JSON 文件持久化 + 进程内 state，
server 用 Cloudflare Workers + Postgres + Redis + KV。

## 当前文件状态

| 目录/文件 | 状态 |
|---|---|
| `src/routes/` | 接口骨架 + 路由挂载就绪 |
| `src/routes/mock-fallback.ts` | 本地联动代理桥，缺口功能转发到 apps/api |
| `src/middleware/` | cors / error / rate-limit / request-id 就绪；**`auth.ts` 是 dev-mode 占位** |
| `src/llm/` | provider/router/sanitizer 已抽到 `@yelan/llm`；本地仅剩 `create-router.ts`、`prompt-cache.ts`、`context-compress.ts` |
| `src/pipeline/` | `handle-chat-turn.ts` 接线就绪；`cost-tracker.ts` 已接 D1；`memo-extractor.ts` 已接 LLM |
| `src/prompts/` | 装配逻辑委托给 `@yelan/shared` 的 `renderSystemPromptSimple` |
| `src/db/` | PG + Redis client 就绪 |
| `src/services/` | `logs.ts`/`surveys.ts`/`characters.ts` 已接 D1；**`auth.ts`/`billing.ts` 是 dev-mode 占位（见上方地雷表）** |
| `src/observability/` | metrics / alerts 就绪 |
| `wrangler.toml` | CF Workers 配置就绪 |
