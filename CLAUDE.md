# 夜阑 — Claude / AI 协作说明

> 本文件会被 Claude Code 等工具在**每个新会话自动加载**进上下文。改动调试/运行约定时请同步更新这里，
> 让新窗口的 AI 无需重新交代就能认识本项目。详细文档放 `docs/` 与各包的 README，本文件只留「最常用 + 易踩坑」。

## 仓库速览（monorepo / pnpm workspace）

| 路径 | 角色 |
|---|---|
| `apps/api` | **自包含后端**（Hono + Node，JSON 文件持久化，无需 Postgres/Cloudflare）。**ECS 上跑的就是它**，也是本地调试的主体。 |
| `apps/server` | Cloudflare Workers 版后端（`wrangler`），边缘部署的备选线，路由签名与 `apps/api` 1:1 对齐。 |
| `apps/web` | 前端（Vite + React），手机端 + 电脑端共用一套。 |
| `apps/admin` | 可视化后台控制台。 |
| `infra/deploy` | 一键部署：`docker-compose`（apps/api + Caddy 反代 + 自动 HTTPS），目标 = 阿里云 ECS。 |
| `packages/{shared,llm,prompts,design-tokens}` | 共享类型/契约、LLM 路由、提示词、设计令牌。 |

状态真理源：`apps/api/.local/state.json`（本机）/ `infra/deploy/_data/state.json`（部署）。
LLM key/model 存在 **state.json**（首次启动从环境变量「现场播种」），不是 `.env` 长期源。

## 本地仿真 / 调试环境（无需真服务器、无需真 API key）

按保真度从低到高三档，都能在本机跑，**不用租服务器**：

| 档 | 命令 | 说明 |
|---|---|---|
| 快速开发 | `pnpm dev` | api(:8787) + web 并行，localhost 全栈，热重载。日常 90% 调试用这个。 |
| **离线仿真** ⭐ | `pnpm sim` | 在 `pnpm dev` 基础上**拉起 mock-llm 仿真上游**并把所有 LLM provider 指向它 → **完全离线、零额度、确定性可复现**。详见下。 |
| server 模式 | `pnpm start:server` | `DEPLOY_MODE=server`：绑 0.0.0.0、CORS 白名单、强制非默认 token、启动前防呆自检。复现「只在生产模式才出」的 bug。 |
| 全真容器 | `pnpm deploy:up` | 跑要推上 ECS 的**同一个镜像 + Caddy**。**需先装 Docker Desktop**（本机当前未装）。 |

### `pnpm sim` 仿真上游（mock-llm）

- 实现：`scripts/mock-llm-server.mjs`（零依赖），同时讲 **OpenAI 兼容**（`POST /v1/chat/completions`）和
  **Anthropic**（`POST /v1/messages`）两种协议，支持流式 SSE。默认 `127.0.0.1:8799`。
- 启动器：`scripts/start-sim.mjs` 给每家 provider 塞**假 key + 指向 mock 的 baseUrl**，并用隔离目录
  `YELAN_STATE_DIR=apps/api/.local-sim` 起服务 —— **绝不碰你真实的 `apps/api/.local/state.json`**。
- 主对话：返回带「【mock-llm】」标记的确定性回复（回显用户输入），方便一眼认出非真实模型。
- 侧袋任务（结构化输出/偏好/配额/上下文压缩，走 `response_format=json_object`）：mock 返回 `{}`，
  消费方会 zod 校验失败优雅降级或 normalize 兜底 —— 即**侧袋增强在 sim 下是「降级/不生效」而非报错**。
  需要侧袋真效果时仍要接真实/更聪明的上游。
- 单独起仿真上游：`pnpm mock:llm`。调流式间隔：`MOCK_LLM_DELAY_MS=0 pnpm mock:llm`。

### 踩坑提示

- **改了 sim 的 provider 配置后没生效？** LLM 清单只在 state.json 为空时播种一次。删掉
  `apps/api/.local-sim` 再 `pnpm sim` 让它重新播种。
- **别把真实 API key 写进 `CLAUDE.md` 或任何进 git 的文件**（本文件会提交）；真 key 放根 `.env`（已 gitignore）。
- 手机端是纯前端，**不需要服务器**：浏览器 DevTools 响应式模式即可测；相关 hook 见 `apps/web/src/hooks/useViewport.ts`、`useEdgeSwipe.ts`。
- `apps/api` 种子主模型按 Anthropic > OpenAI > DeepSeek > NVIDIA 取第一个有 key 的；四家的 `*_BASE_URL` 均可用环境变量覆盖（指向代理/网关/mock）。

## 常用校验

```bash
pnpm typecheck            # 全量类型检查
pnpm test                 # 全量单测（各包 vitest）
pnpm verify:gray          # lint + typecheck + 灰度测试 + 契约检查（提交前推荐）
pnpm contracts:check      # 前后端 API 契约一致性
```

## 约定

- 用户偏好用**简体中文**交流；代码注释沿用仓库既有的中文风格与密度。
- 部署/状态相关延伸阅读：`infra/deploy/README.md`、`docs/structure.md`、`README.md`、`接口审计与TODO.md`。
