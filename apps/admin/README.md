# admin · 运营后台

当前有两套 UI：

- `apps/admin/src` + `dist/`：React 后台，`/admin` 优先加载，正在成为主后台。
- `apps/admin/console.html`：旧版单文件后台，已冻结；`/admin-legacy` 仅保留为本机 DevOps 视图。

两套 UI 当前都调用同一组 `apps/api/src/routes/admin/*` 接口。通过 `pnpm dev:server` 进入新后端联动模式时，`apps/server:8789/admin` 会代理到 apps/api 托管的后台资源。

## ⚠️ 改源码后要不要 build？(必读)

| 入口 | 实际读取 | 改 `src/**` 后 |
|---|---|---|
| `5173`（`pnpm --filter admin dev`，Vite dev） | `apps/admin/src/` | **HMR 即时生效，不用 build** |
| `8787/admin`（api 内嵌静态） | `apps/admin/dist/` | **必须先 `pnpm --filter admin build`** |

`pnpm --filter api dev` 是 `tsx watch src/index.ts`，只 watch api 自己的 TS，**完全不构建 admin**。
所以经 `8787/admin` 访问时，看到的永远是上一次 build 的 `dist/` 产物——改了 admin 源码不 build 就不会变。
托管逻辑见 `apps/api/src/index.ts` 的 admin 静态托管块。

## 启动方式

**方式 1（推荐）—— 通过 apps/api 静态托管**

```powershell
pnpm dev:mock
# 浏览器打开 http://127.0.0.1:8787/admin
```

**方式 2 —— 通过新后端联动入口**

```powershell
pnpm dev:server
# 浏览器打开 http://127.0.0.1:8789/admin
```

该模式只用于本地/测试联调：`apps/server` 是入口，完整后台能力仍来自 `apps/api`。

**方式 3 —— 旧版 HTML 直接 file:// 打开**

由于 apps/api 本地 CORS 全开，`apps/admin/console.html` 也可以直接双击在浏览器打开。
此时控制台会用 `localStorage['yelan.apiBase']` 作为 API base，默认指向 `http://localhost:8787`。

## 默认 ADMIN_TOKEN

本地默认 `admin-dev-token`（见 `.env.example` / `apps/api/src/middleware/auth.ts#requireAdmin`）。
首次进入需在顶栏输入 → "保存并测试"。

## 面板口径

React 后台迁移进度（2026-06-11）：

**已原生实现（23 个）**：全部面板已 React 化。`overview` / `config` / `characters` / `constellations` / `policy` / `membership` / `prelude-cards` / `prompts` / `sidecar-prompts` / `if-codes` / `surveys` / `chat-test` / `audit` / `users` / `candle` / `quota` / `sessions` / `costs` / `llm` / `setup` / `health` / `diagnostics` / `pay-test`

**仍走旧后台（0 个）**：迁移完毕。

**外链面板（1 个）**：`db-tools`（直链 `localhost:5174`，不入 React 路由）。

路由注册表见 `src/routes/registry.ts`，新增面板只需加一条记录 + 一个路由文件。

旧版 `console.html` 已冻结，仅通过 `/admin-legacy` 提供，且注入了哈希守卫：非 `#db-tools` 的访问自动重定向到 React `/admin`。仅 `DbToolsPanel` 的"打开旧说明"链接可用；新增后台能力一律进 React routes。

## 代码组织

### React 后台

```
apps/admin/src/
├── App.tsx
├── main.tsx
├── api/client.ts
├── components/
│   ├── Shell.tsx          # 顶栏 + 侧栏 + API 切换
│   ├── Sidebar.tsx        # 导航分组，按 registry 动态判断路由
│   ├── Toast.tsx          # 全局 toast 通知
│   ├── ReasonDialog.tsx   # 写操作前收集变更原因
│   ├── ConfirmDanger.tsx  # 破坏性操作二次确认
│   ├── JsonViewer.tsx     # JSON 美化展示
│   └── DataTable.tsx      # 通用表格（columns + rows）
├── routes/
│   ├── registry.ts        # RouteDef 注册表（hash → component 唯一真理源）
│   ├── Overview.tsx       # 总览
│   ├── ServiceConfig.tsx  # API 仓库 + .env 编辑 + 运行期覆盖
│   ├── Characters.tsx     # 角色卡
│   ├── Policy.tsx         # 策略
│   ├── Membership.tsx     # 会员套餐 / 人工开通 / 到期不续
│   ├── PreludeCards.tsx   # 前置提示卡
│   ├── Prompts.tsx        # Prompt 灰度
│   ├── SidecarPrompts.tsx # 侧袋 Prompt
│   ├── IfCodes.tsx        # IF 暗号
│   ├── Surveys.tsx        # 问卷
│   ├── ChatTest.tsx       # 对话测试
│   ├── Audit.tsx          # 审计日志
│   ├── Users.tsx          # 用户管理
│   ├── Candle.tsx         # 烛账
│   ├── Quota.tsx          # 配额
│   ├── Sessions.tsx       # 会话
│   ├── Costs.tsx          # 成本统计
│   ├── LlmTest.tsx        # LLM 测试
│   ├── Setup.tsx          # 一键向导
│   ├── Health.tsx         # 健康检查
│   ├── Diagnostics.tsx    # 诊断
│   └── PayTest.tsx        # 支付测试 (mock-only)
└── styles/globals.css
```

`routes/Characters.tsx` 已支持 `styleTags` 与 `forbiddenPhrases` 编辑，保存后走 `POST/PATCH /api/admin/characters`。

### 旧版 HTML 后台

冻结规则：不新增面板、不新增业务 API 调用、不扩展产品行为；只允许修安全问题、入口兼容问题和文字说明。

| 章节锚点 | 内容 |
|---|---|
| §1 | 设计 token + 全局样式（深色 + 纸金主题，与 web 一致） |
| §2 | 顶部条 + 侧栏 + 主区骨架；通用控件 / toast / modal |
| §3 | 全局状态 / NAV 配置 / DOM helpers / API 封装 / 健康 ping |
| §4 | view 函数集合 — 每个返回 HTML 字符串，afterMount 内绑事件 |
| §5 | hash 路由 + 初始化 |

### 怎么加一个新面板

1. 新建 `apps/admin/src/routes/NewPanel.tsx`（参考现有面板的 DataTable / modal 模式）
2. 在 `registry.ts` 加一条记录：`hash → lazy(() => import(...))`
3. 如需新接口：`apps/api/src/routes/admin/<name>.ts` + `admin/index.ts` mount

### 怎么改主题

修改 `apps/admin/src/styles/globals.css` 的 CSS 变量。

## API 后端

控制台调的所有 `/api/admin/*` 实现在 `apps/api/src/routes/admin/`：

```
admin/
├── index.ts        # 挂载 + requireAdmin 中间件
├── _audit.ts       # 公共审计落库
├── health.ts       # /health 概览聚合
├── diagnostics.ts  # /diagnostics 体检（schema 与 scripts/doctor.mjs 对齐）+ /test-all
├── seed.ts         # /seed 一键灌示例
├── config.ts       # env 读写 + 运行期覆盖 + LLM 测试
├── candle.ts       # 发烛 + 流水
├── quota.ts        # GET 配额快照 / bonus 发放 / 免费上限 / 兑换开关
├── users.ts        # 列表 + flag patch
├── surveys.ts      # 创建 / patch / toggle / 导出
├── prompts.ts      # 版本 / release / rollback
├── costs.ts        # daily / per-user / cache-hit
├── if-codes.ts     # 增删改 + 兑换记录
├── sidecar-prompts.ts # 侧袋 AI prompt 查看/修改/审计
├── characters.ts   # 角色卡 CRUD（DB → yaml fallback；BE-101）
├── membership.ts   # 会员套餐配置 / 人工开通 / 到期不续
├── audit.ts        # 审计读
└── sessions.ts     # 会话调试
```

## 三种入口对应

| 想做的事 | CLI 出口 | 控制台出口 |
|---|---|---|
| 体检 | `pnpm doctor` | `#setup` 体检清单 |
| 初始化 / 填 key | `pnpm setup` | `#config` 服务配置 |
| 灌示例数据 | `pnpm seed` | `#setup` → 灌示例数据 按钮 |
| 测所有 LLM | — | `#setup` → 测试所有 LLM 按钮 / `#llm` 单测 |
| 启动一条龙 | `pwsh ./scripts/dev.ps1` 或 `./scripts/dev.sh` | — |
| 快速进后台 | 双击根目录 `打开可视化后台.cmd` | `#setup` / `#sidecar-prompts` |

## 安全提示

- **仅用于本地 dev** — 这套 admin 能写 `.env`、改用户 flag、发烛。
- React 后台前端已移除默认 token fallback（`api/client.ts`），无 token 时所有 API 调用返回 401。
- apps/api 在检测到默认 `admin-dev-token` 时拒绝非本机 IP（`auth.ts#requireAdmin`）。
- 生产环境必须设非默认 `ADMIN_TOKEN`，并确保 `ENABLE_ADMIN_CONSOLE=false`。
- `pnpm dev:server` 的联动代理只准本地/测试使用，不准作为生产依赖。

## 与生产规划（apps/server）的关系

| 阶段 | admin UI | admin API | token 来源 |
|---|---|---|---|
| Phase 0（当前） | React `/admin`（全量 23 面板）；`/admin-legacy` 仅 db-tools 哈希可用 | `apps/api/src/routes/admin`；`pnpm dev:server` 可经 server 代理 | `ADMIN_TOKEN` env，默认 `admin-dev-token` |
| Phase 1 W5+ | React + Vite（同 web 技术栈） | `apps/server/src/routes/admin` 真实现 | `wrangler secret` |
| Phase 1 GA | 同上 | 同上 + 真 PG/Redis | 不再使用 apps/api JSON-file fallback |

`console.html` 在 Phase 1 也可保留，作为开发者本机调试 apps/api 用的"DevOps 视图"；但上线后台必须以 React + 真 server API 为准。
