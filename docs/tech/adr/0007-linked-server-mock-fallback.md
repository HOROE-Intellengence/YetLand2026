# ADR-0007: 本地新后端入口代理 mock-server 缺口功能

日期：2026-05-11

## 状态

Accepted for local/test only.

## 背景

`apps/server` 是 Cloudflare Workers 路线的新后端入口，但当前大量业务实现仍是 stub。`apps/mock-server` 反而已经承载完整本地/当前 Docker 路线能力，包括 `/api/chat`、`/api/admin/*`、侧袋 AI、角色卡、用户、配额、支付 mock 等。

为了测试“新后端入口”下的前端/后台访问路径，同时避免一次性把所有 mock-server 逻辑搬进 Workers，我们需要一个短期桥接方案。

## 决策

新增 `apps/server/src/routes/mock-fallback.ts`，仅在显式环境变量开启时，将 `apps/server` 收到的以下路径代理到 `apps/mock-server`：

- `/api/*`
- `/admin`
- `/admin/*`
- `/admin-legacy`
- `/admin-legacy/*`
- `/assets/*`

根目录 `pnpm dev:server` 改为联动启动脚本：

- 复用或启动 `apps/mock-server`，默认 `127.0.0.1:8787`
- 启动 `apps/server`，默认 `127.0.0.1:8789`
- 注入 `ENABLE_MOCK_FALLBACK=true`
- 注入 `MOCK_SERVER_BASE=http://127.0.0.1:8787`

原始 Workers stub 启动命令保留为 `pnpm dev:server:raw`。

## 非目标

- 不把 mock-server 变成 Workers 生产依赖。
- 不用 fallback 掩盖 `apps/server` 的真实实现缺口。
- 不保证所有 HTTP/SSE/静态资源边界都已完整验证。
- 不把默认 `admin-dev-token` 带入生产后台。

## 风险

1. 代理桥会转发 `Authorization` 等敏感头；如果误开到非本地环境，等于扩大 mock-server 暴露面。
2. Worker runtime 对 Node/Hono SSE 响应存在兼容差异；已做冒烟修复，但仍需专门集成测试。
3. `/assets/*` 代理可能和未来 Workers 静态资源托管冲突。
4. 新后端入口返回的数据实际来自 mock-server，测试报告必须标明“linked fallback”，不能误判为 Workers 真实业务实现已完成。
5. mock-server 的 `.local/state.json` 仍是本地真相源；联动模式不会验证 Postgres/Redis/KV。

## 强制约束

- 生产部署不得设置 `ENABLE_MOCK_FALLBACK=true`。
- `MOCK_SERVER_BASE` 不得指向生产内网或公开 mock-server。
- CI/测试必须能区分 `pnpm dev:server` 与 `pnpm dev:server:raw`。
- Workers 生产化时，应逐路由移除 fallback 依赖，而不是扩大代理范围。

## 已验证

- `pnpm --filter "./apps/server" run typecheck`
- `http://127.0.0.1:8789/health` 返回 `mockFallback.enabled=true`
- `http://127.0.0.1:8789/admin` 返回后台页面
- `http://127.0.0.1:8789/api/admin/characters` 返回 200 且带 `x-yelan-proxied-by: apps/server`
- `http://127.0.0.1:8789/api/chat` 返回 SSE，事件包含 `meta / atmosphere / chunk / structured / done`

## 仍需测试

见 `../../TODOlist.md` 的 `TEST-105`。
