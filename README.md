# 夜阑 · Monorepo

> **Version**: 0.8.7

## 文档索引

| 文档 | 路径 | 说明 |
|---|---|---|
| 产品经理手册 | [`docs/product/产品经理手册.html`](docs/product/产品经理手册.html) | 愿景/市场/MVP/设计系统/商业模式/GTM，PM 主文档 |
| 开发文档 | [`docs/开发文档.md`](docs/开发文档.md) | 全栈工程主文档，含设计资产/Token 同步/运维 SOP 规划 |
| 结构文档 | [`docs/structure.md`](docs/structure.md) | 仓库结构 + 关键工程约定（与 README 设计原则互补） |
| 待办清单 | [`docs/TODOlist.md`](docs/TODOlist.md) | 当前迭代任务追踪 |
| 接口审计 + TODO | [`接口审计与TODO.md`](接口审计与TODO.md) | 前后端接口连通性 / 伪代码追踪 / 上线前债务（2026-05-14 含灰测卫生包） |
| 灰测卫生 checklist | [`docs/gray-test-checklist.md`](docs/gray-test-checklist.md) | 灰测开测前/中/后的入场命令、SSE 部署检查、中止判据、回滚步骤 |
| Secrets 管理 SOP | [`docs/operations/secrets-management.md`](docs/operations/secrets-management.md) | INTERNAL_TOKEN 等 secret 的添加/轮转/应急流程（INFRA-107）|
| Sprint 工单 | [`docs/sprint/`](docs/sprint/) | dev-facing 任务清单（含文件路径、改法、验收命令）。当前活跃：[**phase3-handoff**](docs/sprint/phase3-handoff.md) / [phase3-postgres](docs/sprint/phase3-postgres.md)。Phase 2 已合 main：[handoff](docs/sprint/2026-05-14-handoff.md) / [edge-layer](docs/sprint/2026-05-14-edge-layer.md) / [report](docs/sprint/2026-05-14-report.md)。近期专题：[memory-channel-audit](docs/sprint/2026-05-21-memory-channel-audit.md) / [prompt-caching-audit](docs/sprint/2026-05-21-prompt-caching-audit.md) |
| 架构审计 | [`docs/tech/architecture-audit.md`](docs/tech/architecture-audit.md) | 代码质量 / 完成度 / 风险评估（2026-05-10） |
| 专项审计 | [`docs/audit/`](docs/audit/) | 鉴权/延迟/记忆/会员等专项调查与修复报告：[user-account](docs/audit/user-account-2026-05-20.md)（邮箱+密码鉴权 + 错码表）/ [chat-latency](docs/audit/2026-05-21-chat-latency-fix-report.md) / [membership-mock](docs/audit/2026-05-27-membership-mock-subscription.md) |
| 数据归属表 | [`docs/architecture/data-locality.md`](docs/architecture/data-locality.md) | 每个数据实体的真相源 / 同步策略 / 删除路径 |
| ADR | [`docs/tech/adr/`](docs/tech/adr/) | 架构决策记录（只增不改，旧版标 Superseded） |
| 3-Skill AI 团队约定 | [`docs/agents/`](docs/agents/) | Claude main / DeepSeek 下属 / Codex 验证机 三角色入场简报；跨会话协作纪律 |

## Git / GitHub 协作提醒

远端仓库：[`HOROE-Intellengence/YELAN-GIT`](https://github.com/HOROE-Intellengence/YELAN-GIT)，本地默认远端名为 `origin`。

```powershell
git status --short --branch   # 看当前分支、是否有未提交改动
git pull --ff-only            # 只允许快进同步，避免莫名其妙的 merge commit
git push                      # 只上传已经 commit 的内容
```

必须记住：

1. **`git remote add` 只是连地址，`git push` 才是真的上传。**
2. **未 commit 的文件不会上 GitHub。** 现在看到 `M` 或 `??`，说明它还只在本机。
3. **不要提交 secret。** `.env`、`.env.local`、`.dev.vars`、API key、token、私钥一律留本机；需要模板就改 `.env.example`。
4. **推 main 前先自检。** 小改至少跑 `pnpm typecheck`；灰测/上线相关改动跑 `pnpm verify:gray`。
5. **多人协作先开分支。** 分支名建议 `codex/<任务名>` 或 `feat/<任务名>`，确认合入后再删本地分支。
6. **仓库可见性由 GitHub 设置决定。** Public 全网可见，Private 只有授权成员可见。

## 目录速览

```
夜阑/
├── docs/                  产品手册、开发文档、ADR、设计/运维 SOP
├── prototype/             原始 React UMD + JSX 原型（视觉真理源，打开 夜阑.html 即可演示）
├── apps/
│   ├── web/               主前端 SPA（React 18 + Vite + TS + CSS Modules）
│   ├── server/            Cloudflare Workers edge 层（静态入口/边缘鉴权/rate-limit/CORS + fallback 到 api；ADR-0008）
│   ├── unlim-worker/      NVIDIA 限制解除器（独立 Worker，主 LLM 之一）
│   ├── api/               主后端（Node + Hono），真实业务实现 + 持久化，生产入口
│   ├── admin/             运营后台前端
│   └── share/             长图分享子站（Next.js）
├── packages/
│   ├── shared/            前后端共享类型 / zod schema / contracts 契约 / 常量
│   ├── llm/               @yelan/llm — 前后端共享 LLM 层（provider/LlmRouter/pricing/think-sanitizer/stream-guard）
│   ├── prompts/           Prompt as Code（角色卡 yaml、boundary、strategy）
│   └── design-tokens/     单一真理源的设计 token
├── infra/
│   ├── db/                Postgres 迁移工具（CLI + GUI）
│   ├── cloudflare/        KV / R2 / secrets 说明
│   ├── deploy/            Docker 部署（Caddy + 自动 HTTPS）
│   └── ci/                GitHub Actions（typecheck + deploy）
├── scripts/               一键开发脚本、seed-data 等
├── 打开可视化后台.cmd/.ps1 Windows 一键启动 api 并打开运营后台
└── 快速启动真前端.bat/.ps1 Windows 一键起 api + web 并打开前端（缺依赖自动 install）
```

## 快速开始

### 本机开发（30 秒）

```powershell
pnpm setup            # 首次：拷 .env / 问 API key / 装依赖
pnpm start:full       # 起前端 + api（DEPLOY_MODE=local）
```

Windows 也可以直接双击根目录 `打开可视化后台.cmd`：脚本会启动 `pnpm dev:mock`，轮询 `/health` 就绪后打开控制台。

打开：
- 前端　　　http://localhost:5173
- 控制台　　http://127.0.0.1:8787/admin（默认 token `admin-dev-token`）

### 服务器部署

```bash
cd infra/deploy
cp .env.example .env
nano .env                      # 改 DOMAIN / ADMIN_TOKEN / 任一 LLM key
docker compose up -d --build   # 起来 + 自动 HTTPS
```

打开 `https://your-domain.com/admin`，用 ADMIN_TOKEN 登录。详见 [`infra/deploy/README.md`](infra/deploy/README.md)。

## 命令地图

### 启动 / 切换模式

| 命令 | 做什么 |
|---|---|
| `pnpm start:local` | 本机开发：api 单跑（DEPLOY_MODE=local） |
| `pnpm start:full` | 本机：api + web 同时跑 |
| `pnpm start:server` | 服务器模式：bind 0.0.0.0、CORS 白名单、安全自检 |
| `pnpm deploy:up` | 服务器部署：docker-compose 一键起 |
| `pnpm deploy:down` | 停容器 |
| `pnpm deploy:logs` | 跟日志 |

### 维护

| 命令 | 做什么 |
|---|---|
| `pnpm setup` | 拷 `.env.example→.env`、交互问 key、装依赖（首次） |
| `pnpm doctor` | 体检 10 项（Node / pnpm / .env / LLM / 服务 / 资产） |
| `pnpm seed` | 调 api 灌 3 用户 + 暗号 + 支付样例 |
| `pnpm dev:check` | `doctor && dev` |

### 开发

| 命令 | 做什么 |
|---|---|
| `pnpm dev` | 等价 `pnpm start:full` |
| `pnpm dev:web` | 单跑前端 |
| `pnpm dev:mock` | 单跑 api（Node 后端） |
| `pnpm dev:server` | 联动新后端：自动复用/启动 `apps/api`，并在 `8789` 启动 `apps/server` |
| `pnpm dev:server:raw` | 只跑 Cloudflare Workers server stub（不接旧功能） |
| `pnpm dev:unlim` | 单跑 unlim-worker |
| `pnpm build` | 先 prompts:build，再级联 build 所有 app |
| `pnpm typecheck` | 全仓类型检查 |
| `pnpm lint` | 全仓 lint |
| `pnpm test` | 全仓测试 |
| `pnpm test:gray` | 灰测回归套件（events / admin / SSE / cutoff / token-guard / requestId） |
| `pnpm verify:gray` | **灰测开测前唯一门禁**：lint + typecheck + test:gray + contracts:check（含模式纪律 grep 守门） |
| `pnpm contracts:check` | 三向对比 contracts/api/server 路由 + 禁止裸 `Schema.parse(await c.req.json())` |
| `pnpm gray:snapshot` | 备份 `apps/api/.local/state.json` 到时间戳目录 |
| `pnpm gray:reset` | 从 baseline 或最新快照恢复 state.json（无 baseline 则报错不删） |

## 一键切换 API 端点

让同一份前端代码指向"本机后台"或"线上后台"，无需重新构建。

### Web 前端

| 方式 | 操作 | 优先级 |
|---|---|---|
| URL 参数 | 访问 `?api=https://api.example.com` 即落 localStorage，下次不用带 | 高 |
| localStorage | `localStorage['yelan.apiBase'] = 'http://localhost:8787'` | 中 |
| 构建期 | `VITE_API_BASE=https://api.example.com pnpm build` | 低 |
| 兜底 | `http://localhost:8787` | 最低 |

实现：[`apps/web/src/config/env.ts`](apps/web/src/config/env.ts)

### Admin 控制台

顶栏左侧的 **部署模式徽章**（`💻 LOCAL` / `🌐 SERVER`）— 点一下弹窗：

- 预设按钮：本机 api / 当前页同源
- 自定义输入：贴任意 `https://...` 地址
- 保存即切换 + 自动 ping + 重新渲染

## 部署模式 Profile

| 字段 | local | server |
|---|---|---|
| `DEPLOY_MODE` | `local` | `server` |
| 监听地址 | `127.0.0.1`（仅本机） | `0.0.0.0`（任何接口） |
| CORS | `*` 全开 | `CORS_ORIGINS` 白名单 |
| ADMIN_TOKEN | 默认 `admin-dev-token` 可用 | 强制非默认（除非 `ALLOW_DEFAULT_ADMIN_TOKEN=true`） |
| /admin 控制台 | 开 | `ENABLE_ADMIN_CONSOLE` 开关（默认开） |
| 启动日志 | 详细横幅 | 简洁单行 |
| 信任反代 | 否 | 是（`TRUST_PROXY=true`） |
| 状态卷 | `apps/api/.local/` | docker volume `infra/deploy/_data/` |

源码：`apps/api/src/config/deploy-mode.ts`

## 运营后台

打开 `http://127.0.0.1:8787/admin` 进入 React 原生控制台。左侧边栏按功能分组：

- **监控**：一键向导 / 总览 / 健康检查 / 诊断 / 成本统计 / 审计日志
- **配置**：API 仓库 / LLM 测试 / 策略 / 角色卡 / 会员 / 前置提示卡 / Prompt 灰度 / 侧袋 Prompt
- **用户**：用户管理 / 会话 / 烛账 / 配额 / IF 暗号
- **工具**：对话测试 / DB 工具 / 支付测试 / 问卷

首页默认为 **总览** 面板。所有写操作需填写变更原因，记录审计日志。
侧袋 AI Prompt 在 **侧袋 Prompt** 面板中维护。

## 五种"卡住"场景

| 现象 | 命令出口 | 控制台出口 |
|---|---|---|
| 不知道现在啥状态 | `pnpm doctor` | 总览面板 + `#setup` 一键向导 |
| 想填 / 改 API key | `pnpm setup` | `#config` 服务配置面板 |
| 数据是空的 | `pnpm seed` | `#setup` → "灌示例数据" |
| LLM 是不是真能调通 | — | `#llm` 测试 / `#setup` → "测试所有 LLM" |
| Failed to fetch | `pnpm doctor` 看哪项 fail | 控制台首屏自动出诊断卡 |

## 切换 LLM Provider

`.env` 任填一个：

```
ANTHROPIC_API_KEY=sk-ant-...    # stage in {climax, after} 优先用
OPENAI_API_KEY=sk-...
DEEPSEEK_API_KEY=sk-...         # stage in {daily, rise} 优先用（便宜）
SIDECAR_API_KEY=sk-...          # 可选：侧袋 AI 专用，未填则复用 DEEPSEEK_API_KEY
```

无 key 时回落脚本化 SCRIPT 流。路由策略：`packages/llm/src/router.ts`（`LlmRouter`），由 `apps/api/src/llm/create-router.ts` 注入库存配置

## UI 原型

打开 `prototype/夜澜.html`（浏览器直接运行，无需构建），这是 PM 确认的目标 UI 视觉基线。

## Prompt 资产

```bash
pnpm prompts:build  # 把 packages/prompts/ 下的 yaml/md 烘成 src/generated.ts
pnpm prompts:watch  # 开发期监听 yaml/md 变化自动重烘
```

详见 `packages/prompts/README.md`。

## 数据库迁移

```bash
pnpm db:status      # 查看迁移状态
pnpm db:up          # 应用所有 pending 迁移
pnpm db:new <name>  # 生成下一个编号的迁移文件
pnpm db:gui         # 打开图形界面 → http://localhost:5174
pnpm db:reset       # 危险：清空 schema 重跑（需 MIGRATE_ALLOW_DESTRUCTIVE=true）
```

详见 `infra/db/README.md`。

## 目录速查

```
scripts/
├── doctor.mjs       零依赖体检 CLI（--json 输出可被 CI 吃）
├── setup.mjs        交互式初始化（拷 .env / 问 key / install）
├── seed-data.mjs    HTTP 调 api 灌示例
├── dev-server-linked.mjs 新后端联动入口：server:8789 → api:8787
├── dev.ps1          Windows 一条龙：doctor → install → dev
└── dev.sh           macOS/Linux 同上

根目录:
├── 打开可视化后台.cmd  Windows 双击入口
├── 打开可视化后台.ps1  启动 api，轮询 /health 后打开 /admin
├── 快速启动真前端.bat  Windows 双击入口（起真前端，非 mock）
└── 快速启动真前端.ps1  缺依赖自动 install，按需起 dev/dev:mock/dev:web，就绪后打开 5173

apps/admin/
├── src/routes/      React 原生面板（总览/配置/用户/工具 四大分组）
├── console.html     旧版控制台（仅 DB 工具外链保留引用）
└── README.md        面板清单 + 扩展指南

apps/api/src/routes/admin/
├── diagnostics.ts   /api/admin/diagnostics 给向导吃
├── seed.ts          /api/admin/seed 一键灌示例
├── config.ts        /api/admin/config env 读写
└── …                health / candle / quota / users / surveys / prompts / sidecar-prompts / costs / if-codes / audit / sessions
```

## 设计原则

1. **Prompt 不在代码里** — 全部进 `packages/prompts/`，改 prompt 不改 TS。
2. **类型只有一份** — `packages/shared/` 是前后端 DTO 唯一来源。
3. **后端职责分层** — `apps/api` 是业务 API 真理源；`apps/server` 是 Worker edge 层（静态入口 / 边缘鉴权 / rate-limit / CORS / security headers / fallback）。新增业务路由默认只进 `apps/api`，边缘策略变化才改 `apps/server`。见 [ADR-0008](docs/tech/adr/0008-deployment-shape-decision.md)。
4. **合规开关只动配置** — 不分散到代码里。
5. **服务器是数据真理源** — 长期记忆 / UI 偏好 / 烛账 / 会话全部账号绑定上行；浏览器 Dexie 仅做缓存 + 嵌入计算。详见 [ADR-0005](docs/tech/adr/0005-account-bound-state.md) + [数据分工表](docs/architecture/data-locality.md)。
6. **设计 token 单一来源** — `packages/design-tokens/` 是真理源。
7. **侧袋 AI 是薄函数，不是 Agent 平台** — 5 个侧袋任务走 `apps/api/src/sidecar-ai/` + 后台 prompt 文本框；不要恢复 `agent_config` / `#agents` 重架构。
8. **server 联动 fallback 只准本地/测试** — `pnpm dev:server` 会把 `apps/server:8789` 的 `/api/*`、`/admin` 代理到 `apps/api:8787`，用于新入口联调；不得在未审计环境开启 `ENABLE_MOCK_FALLBACK`。
9. **LLM 层只有一份** — provider / 路由 / 计价 / `<think>` 过滤都在 `packages/llm`（`@yelan/llm`），`apps/api` 与 `apps/server` 共用，不各自复制 provider 实现。

## 关键约定

1. **Reason 必填** — 控制台所有写动作都要填 reason，落 `state.adminAudit`，可在 `#audit` 面板查
2. **Secret 脱敏** — `/api/admin/config` 读 API key 时只显示首尾 4 位
3. **同源访问最稳** — 控制台从 `http://127.0.0.1:8787/admin` 打开避开浏览器跨源拦截
4. **state.json 可删** — 删 `apps/api/.local/state.json` 即重置一切
5. **持久化自带快照兜底** — api 运行时按 30 分钟节流自动快照到 `apps/api/.local/snapshots/`（保留最新 12 份）；`state.json` 解析失败时坏文件原样隔离为 `corrupt-*.json`（保留 5 份），并自动从最近一份可用快照恢复，绝不静默清空。`.local/` 已 gitignore，不入库。

## 不在本阶段范围

- `apps/unlim-worker`（侧袋 NVIDIA AI，独立 Worker）
- `apps/server` 独立生产化（当前可用 `pnpm dev:server` 联动 `apps/api` 做新入口联调）
- 真 Postgres / Redis / 支付签名校验（当前会员购买是灰测 mock 激活）
- `apps/share`（长图分享子站）
