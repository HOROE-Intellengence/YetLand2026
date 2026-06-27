# 接口审计与 TODO

> **首次审计**：2026-05-13
> **最近更新**：2026-05-27（apps/api 改名 / BE-134 stub 收口 / 邮箱鉴权 / 记忆治理 / @yelan/llm 抽包 / 会员 mock 闭环 后补记；原始审计正文为 2026-05-14 快照，保留）
> **审计目标**：检查前后端接口连通性、定位伪代码/预设返回、追踪上线前债务
> **结论一句话**：本地后端（`apps/api` @ 8787，前身 mock-server）功能完整且**已通过灰测卫生门禁**；会员订阅已具备灰测 mock 闭环；`apps/server`（Cloudflare Worker edge 层）原本几乎全是 stub 且有未鉴权硬伤，**已由 BE-131（鉴权）+ BE-134（14 stub 删除、routes 22→8）收口**，详见下方状态更新。

---

## 〇、状态更新（2026-05-27）

> 下面 §一~§八 是 2026-05-13/14 的审计快照（含当时的债务清单与排期），保留作追溯。审计之后落地的关键变化：

- **改名**：`apps/mock-server` → `apps/api` 已完成（包名 `@yelan/api`）。正文中现行运营后端的 `apps/mock-server` 一律读作 `apps/api`。
- **§三.A 已收口**：`apps/server` 的未鉴权硬伤与 14 个业务 stub 已由 **BE-131 + BE-134** 解决（admin 加 `requireAdmin`；14 stub 删除、routes 22→8、`/api/*` 交 mock-fallback）；保留型 `auth` / `pay/*` / `db/*` 仍按 F2 待上线前真接。
- **LLM 层抽包**：provider/路由/计价/sanitizer 上提为 `@yelan/llm`，apps/api 与 apps/server 共用（见 `docs/structure.md` v0.8.0）。
- **会员 mock 闭环**：`/api/billing/{plans,subscription,subscribe}` 改读 `services/membership.ts`；后台 `/api/admin/membership/*` 可改套餐价格、折扣、赠烛、上下架并人工开通/取消；有效会员跳过免费额度截断。当前是灰测 mock，真实支付验签仍按 F2 保留。
- **新增能力（非审计范围，登记备查）**：邮箱+密码鉴权（`/api/auth/email`、`/api/me/{password,profile,email/bind,...}`，详见 [`docs/audit/user-account-2026-05-20.md`](docs/audit/user-account-2026-05-20.md)）；记忆门控 `FEATURE_MEMORY_THROTTLE` + 记忆治理（真删/画像快照）。

---

## 一、架构现状

仓库内有**两套后端**，前端 admin/web 调同一个 `/api/*`：

| 后端 | 位置 | 状态 |
|---|---|---|
| `apps/server` | Cloudflare Workers | **决定升级为 edge 层一等公民**（ADR-0008 方案 A）：静态资源 / 边缘鉴权 / rate-limit / CORS / security headers / `/api/*` 透传 |
| `apps/mock-server` → `apps/api` | Node + Hono，容器化 | **决定升级为生产主后端**（ADR-0008 方案 A）：真实业务实现 + Postgres 持久化，灰测卫生包已加固 |

`apps/server` 通过 [mock-fallback.ts](apps/server/src/routes/mock-fallback.ts) 把 `/api/*` 代理到 Node 后端。ADR-0008 将 `ENABLE_MOCK_FALLBACK=true` 从"本地联动"升级为"生产配置"，但要求 `MOCK_SERVER_BASE` 必须 HTTPS + 出向带内部 token（BE-135/142）。**当前生产路径仍是 Caddy → apps/api**，迁移到上述目标形态见 §六 排期。

---

## 二、连通性测试结果（2026-05-13 实测）

实测 30+ 端点（admin-dev-token）：

- `/health`、`/admin` SPA、`/api/admin/*` 20 个 GET 全部 **200**
- 用户域 `auth/verify`、`billing/*`、`characters`、`achievements`、`surveys/active`、`sessions/recent`、`me/*` 全部 **200**
- 写操作 `auth/otp`、`events`、`logs/conversation`、`if-codes/redeem`、`pay/{wechat,alipay,stripe}` 全部 **200**
- 鉴权：admin 无 token / 错 token → **401**（仅 mock-server；apps/server 见 §三 P0-A）
- 前端 admin 19 个 `/api/admin/*` 调用 ↔ mock-server 路由 **一一对应**
- web 端 19 个 `/api/*` 调用 ↔ mock-server **全部实装**

---

## 三、伪代码/预设返回清单（更新于灰测卫生包后）

### A. `apps/server`（生产入口）— 几乎全是占位

| 文件 | 占位内容 | 灰测窗口影响 |
|---|---|---|
| [auth.ts](apps/server/src/routes/auth.ts) | `{ token: 'TODO', me: null }`、OTP 不发短信 | 不上线即可 |
| [billing.ts](apps/server/src/routes/billing.ts) | 6 个端点全 `[]`/`null`/`'TODO'`/预设数字 | 同上 |
| [characters.ts](apps/server/src/routes/characters.ts) | GET `[]`、unlock 不扣烛 | 同上 |
| [sessions.ts](apps/server/src/routes/sessions.ts) | `null` / `{ id: 'TODO' }` / `[]` | 同上 |
| [achievements.ts](apps/server/src/routes/achievements.ts) | 全部 `[]` | 同上 |
| [surveys.ts](apps/server/src/routes/surveys.ts) | `null` / `{ rewarded: 0 }` | 同上 |
| [events.ts](apps/server/src/routes/events.ts) [if-codes.ts](apps/server/src/routes/if-codes.ts) [logs.ts](apps/server/src/routes/logs.ts) | `{ accepted: true }` / `{ ok: true }` 不入库 | 同上 |
| [pay/{wechat,alipay,stripe}.ts](apps/server/src/routes/pay) | 3 个回调 `{ ok: true }` **不验签** | 同上（保留型） |
| [admin/{candle,quota,users,prompts,costs,surveys}.ts](apps/server/src/routes/admin) | 全部预设；`surveys/:id/export` 返回字面 `'csv,placeholder'` | **见 P0-A** |
| [services/\*.ts](apps/server/src/services) [db/\*.ts](apps/server/src/db) [llm/providers/\*.ts](apps/server/src/llm/providers) | 函数体只有 TODO 注释 | 不上线即可 |
| [middleware/auth.ts:11](apps/server/src/middleware/auth.ts) | `c.set('userId','TODO')` 不校验 token | **见 P0-A** |
| [routes/admin/index.ts:15](apps/server/src/routes/admin/index.ts) | `TODO: requireAdminAuth()` **完全未鉴权** | **见 P0-A** |

### B. `apps/mock-server`（本地实现）— 灰测卫生包后的剩余项

| 位置 | 内容 | 严重度 | 状态 |
|---|---|---|---|
| [admin/costs.ts:27](apps/mock-server/src/routes/admin/costs.ts) | `cache-hit` 硬编码 0.6 | 真正预设 | ✅ **已修**（返回 `{rate:null, reason:'not_available_in_mock'}`） |
| [admin/quota.ts:55](apps/mock-server/src/routes/admin/quota.ts) | `exchange-toggle` 只写审计不影响业务 | 简化 | ⚠️ 仍返 `effective:false`，**显式占位**但未实装 |
| [routes/me.ts:30](apps/mock-server/src/routes/me.ts) | `/api/me/achievements` 静态 `[]` | 重复/可疑 | ✅ **已修**（读 store.userAchievements） |
| [routes/chat.ts:267](apps/mock-server/src/routes/chat.ts) | tokens/cost 用 `length/2` 估算 | 简化 | ⚠️ 仍是估算；token-guard 现按 sessionId 真实累计（部分缓解） |
| [admin/surveys.ts:50](apps/mock-server/src/routes/admin/surveys.ts) | 新建 survey 不传 questions 时插入占位 | 默认值 | ⚠️ 未动 |

### C. 错误处理瑕疵（已全部解决）

- ✅ `POST /api/events` 错 schema → 现在返回 `{ code:'VALIDATION_ERROR', issues:[...], requestId }` 400
- ✅ `POST /api/admin/seed` 无 body → 现在 400 JSON，不是 500
- ✅ **17 处** `Schema.parse(await c.req.json())` 全部改为 `zValidator('json', X, validationHook)`
- ✅ `check-api-contracts.mjs` 加 `FORBIDDEN_PATTERNS` 守门，残留即门禁红灯

---

## 四、灰测卫生包（2026-05-14 已合并）

> 一个独立段落记录"开灰测前必做"的工作，详见 [`docs/gray-test-checklist.md`](docs/gray-test-checklist.md)。
> 经过 2 轮验收，最终 `pnpm verify:gray` 全绿（lint + typecheck + 20 tests + contracts 0 errors + 模式纪律 0 命中）。

| 阶段 | 内容 | 状态 |
|---|---|---|
| **P1** Lint 门禁 | 删除 3 处未使用导入；`pnpm -r run lint` 通过 | ✅ |
| **P2** 最小 UI 壳 | OpeningScene/CharacterSelect/NarrativeCutoff 可点；8 个 drawer panel 占位文案；TypingDots / AchievementFlash 动画；SurveyPanel 真上报 `/api/events` | ✅ |
| **P3** 数据真实化 + 成本闸 | achievements 读 store；cache-hit 返回 null + reason；exchange-toggle 显式 `effective:false`；`FEATURE_REAL_LLM` flag；`token-guard.ts` 单 session + 全局日双闸 | ✅ |
| **P4** 错误/日志/观测 | 全局 requestId 中间件；JSONL 结构化 `.local/logs/error.log`；所有 admin 写接口 + events + seed + chat **统一 zValidator**（17 处改造）；SSE 每个 event 携带 requestId；token-guard deny 写 error.log | ✅ |
| **P5** 测试门禁 | `gray.test.ts` 20 项：events 400 / admin validation / achievements store / costs null / SSE smoke / cutoff / FEATURE_REAL_LLM=off / admin token / health / requestId 一致性 / tokenGuard meta | ✅ |
| **P6** 手册 + 快照 | `docs/gray-test-checklist.md`（启动/验证/SSE/中止判据/成功判据/回滚/requestId 追踪）；`scripts/gray-{snapshot,reset}.mjs`；`pnpm verify:gray` 统一门禁 | ✅ |

### 防再犯机制

任何 PR 描述中宣称"统一/全部/所有"类改造，必须有对应的 grep/AST 守门加进 `check-api-contracts.mjs` 的 `FORBIDDEN_PATTERNS`。本轮已确立两条：

- `Schema\.parse(await c\.req\.json())` 在 `apps/mock-server/src/routes/**` 命中即报错

---

## 五、未完事项（重排紧急度，灰测窗口口径）

### 🔴 灰测期间立即并行做（不阻塞开测，但开测当周内完成）

#### S1 上线形态决策 — ✅ 已定（2026-05-14）

**选定方案 A**：Worker 当 edge + Node 主后端（前身 mock-server，改名 `apps/api`）。详见 [ADR-0008](docs/tech/adr/0008-deployment-shape-decision.md)。

直接锁定的工作分布到 §六 排期：
- 边缘层：BE-131 / BE-134-138 / INFRA-104 / INFRA-107
- Node 主后端：BE-139（改名）/ BE-140-142（Postgres + 内部 token）
- 运维 CI：INFRA-105-106 / INFRA-108
- 测试：TEST-107-109
- 文档：DOC-104

#### P0-A `apps/server` admin 完全没鉴权 — 5 分钟止血

```ts
// apps/server/src/routes/admin/index.ts:15
// TODO: requireAdminAuth() — 与 requireAuth() 区分    ← 还在
adminRoute.route('/candle', adminCandleRoute);   // 无任何中间件
```

加一行 `adminRoute.use('*', requireAdmin())`。即使 S1 选 C 方案删 apps/server，这一行也不浪费。**当前不爆炸的唯一原因是 apps/server 没部署**——任何配错都会暴露。

#### P0-B chat cost/tokens 从 provider usage 取（如果灰测开 FEATURE_REAL_LLM=on）

现在 `length/2` 估算，TOKEN_GUARD 也按这个数判。真接 LLM 时估算可能偏离 2-3 倍，硬闸会提前或滞后触发。修法：从 LLM provider 响应读 `usage.{input,output}_tokens`，没 usage 字段才退回估算。

#### P0-C exchange-toggle 实装或下架

现在 admin 在面板上点开关无效果，灰测 checklist 若包含"测试兑换功能开关"会迷惑。两个选项：
1. 实装：写进 policy_kv，让 unlock 路径读
2. 临时下架：从 admin UI 隐藏该 toggle，TODO 注明 Phase 2 接

### 🟡 灰测结束 + S1 决策后再做

#### S2 `apps/server` 14 个 stub 整理（依赖 S1）

A 方案下：14 个 stub 全部替换为 `return c.json({ code:'BACKEND_UNAVAILABLE' }, 503)`，让 mock-fallback 接管，或直接删文件。
保留型只剩 `auth.ts` + `pay/*` + `db/*`（上线时才真接）。

#### F3 单测覆盖铺开

当前测试集合：`audit / health / policy / quota / gray`。TODO 列的逐路由单测仍未做。
推荐顺序：**先 chat(SSE) + auth + events 这三个最高频的**，剩下排 sprint。

#### S4 持久化升级

`.local/state.json` → 真 DB（Postgres/SQLite/D1）。
上生产前必须做，理由：JSON 文件单进程 fsync、并发写有时序问题、容器重启容易丢。

#### S5 部署运维细化

- Caddy + docker compose ✅ 已有
- 容器化 apps/api healthcheck 段
- `/health` 接监控告警（cron + ping 即可）
- CI pipeline 跑 `pnpm verify:gray`
- `wrangler.toml` 配 `MOCK_SERVER_BASE`（A 方案下）

### 🟢 上线前 1-2 周才接（TODO 明确"保留占位"）

#### F2 真接通

- 短信 OTP — [server/routes/auth.ts](apps/server/src/routes/auth.ts) + [services/auth.ts](apps/server/src/services/auth.ts)
- 微信支付验签 + 幂等入账 — [server/routes/pay/wechat.ts](apps/server/src/routes/pay/wechat.ts)
- 支付宝异步通知验签 — [server/routes/pay/alipay.ts](apps/server/src/routes/pay/alipay.ts)
- Stripe webhook 验签 — [server/routes/pay/stripe.ts](apps/server/src/routes/pay/stripe.ts)

灰测不开放注册、不接真实充值，**这四项就该是 stub，不动**。

---

## 六、推荐执行顺序（ADR-0008 方案 A 锁定后）

### Phase 1 — 灰测窗口（Day 0-7，并行进行）

| Day | 谁 | 任务 ID | 内容 | 阻塞? |
|---|---|---|---|---|
| Day 0 | 后端 1 人 | **BE-131** | `apps/server` admin 加 `requireAdmin`（5 min 止血） | 是 |
| Day 0 | 后端 1 人 | **BE-133** | exchange-toggle：实装 policy_kv 或从 admin UI 下架（10-30 min） | 否 |
| Day 1-2 | 后端 1 人 | **BE-132** | chat usage 从 provider 取（开真实 LLM 时阻塞） | 否 |
| Day 1-7 | 后端 1 人 | **TEST-108** | F3 三个高频路由单测（chat SSE / auth / events） | 否 |
| Day 3-5 | 前端 + 后端 | — | 收灰测反馈，迭代 UI 占位 → 真功能 | — |

### Phase 2 — 边缘层成型（Week 2-3）

| 任务 ID | 内容 | 依赖 |
|---|---|---|
| **BE-135** | mock-fallback 生产级守门（HTTPS + 内部 token） | — |
| **BE-142** | Node 后端接受 + 校验边缘签内部 token | BE-135 对端 |
| **BE-134** | apps/server 14 个业务 stub → 503 让 fallback 接管 | BE-135 |
| **BE-137** | 边缘 CORS 白名单化 | — |
| **BE-138** | 边缘 security headers | — |
| **BE-136** | 边缘 rate-limit（Upstash 或 CF KV） | — |
| **INFRA-104** | wrangler.toml 生产环境变量 | BE-135/142 |
| **INFRA-107** | Cloudflare Workers secrets SOP | INFRA-104 |
| **TEST-107** | 边缘层测试（fallback 守门 / 内部 token / rate-limit） | BE-135-138 |

### Phase 3 — Node 主后端生产化（Week 3-4）

| 任务 ID | 内容 | 依赖 |
|---|---|---|
| **BE-140** | Postgres 接入（替换 store/persistence.ts） | — |
| **BE-141** | state.json → Postgres 一次性迁移脚本 | BE-140 |
| **BE-139** | mock-server → apps/api 改名（可独立排期） | — |
| **INFRA-105** | Docker 生产 compose 含 PG 容器或 managed PG | BE-140 |
| **INFRA-108** | /health 接监控告警 | — |
| **TEST-109** | e2e 注册 → 选角 → 对话 → 消费 | BE-140 |

### Phase 4 — CI / 文档收口（Week 4）

| 任务 ID | 内容 | 依赖 |
|---|---|---|
| **INFRA-106** | CI pipeline（typecheck + verify:gray + docker build + Worker publish） | INFRA-104/105 |
| **DOC-104** | 生产部署 runbook `infra/deploy/PRODUCTION.md` | 上述全部 |

### Phase 5 — 上线前 1-2 周（F2 真接通）

短信 OTP、微信/支付宝/Stripe webhook 验签——TODO 列表 §三 F2，保留 stub 直到这里。

---

## 七、灰测当天最小入场命令

```powershell
pnpm install --frozen-lockfile
pnpm verify:gray                  # 必须全绿
pnpm gray:snapshot                # 留快照
pnpm start:full                   # 本地 或
pnpm deploy:up                    # 服务器
curl http://localhost:8787/health # 二次自检
```

详细 checklist 见 [`docs/gray-test-checklist.md`](docs/gray-test-checklist.md)。

---

## 八、版本与变更追溯

| 时间 | 变更 | 关联 |
|---|---|---|
| 2026-05-13 | 首次接口审计，定位 56 个 TODO 与伪代码 | 本文 v1 |
| 2026-05-14 | 灰测卫生包合并（P1-P6），17 处 zValidator 改造、token-guard 硬闸、requestId 全链路、20 tests、verify:gray 门禁 | 本文 v2 |
| 2026-05-14 | S1 上线形态决策：方案 A 拍板 — Worker edge + Node 主后端；DEFER-002 重定义；新增 BE-134-142、INFRA-104-108、TEST-107-109、DOC-104 | [ADR-0008](docs/tech/adr/0008-deployment-shape-decision.md) Accepted |
| 2026-05-14 | Sprint Phase 1 完成：BE-131/132/133/TEST-108 全部 ✅。apps/server admin 鉴权就绪；chat 真 provider usage 计价（pricing.ts，6 provider）；exchange-toggle policy_kv 闭环；新增 chat/auth/events 路由单测 23 项；全仓 82/82 tests passed。验收 1 轮通过，无返修 | [sprint/2026-05-14-gray-window.md](docs/sprint/2026-05-14-gray-window.md) |
| 2026-05-14 | 起 Sprint Leftovers 工单：FE-120 / AD-107 / chat.ts:71 / DOC-102 / INFRA-101 cron 五件灰测窗口期间并行做的小事 + INTERNAL_TOKEN 启动会 agenda | [sprint/2026-05-14-leftovers.md](docs/sprint/2026-05-14-leftovers.md) |
| 2026-05-14 | INTERNAL_TOKEN 启动会完成：4 决策点全部拍板（纯文本共享密钥 / Worker Secrets + Node .env / X-Internal-Token header / 手动轮转不设期）；Phase 2 全套 9 工单就位 | [ADR-0009](docs/tech/adr/0009-internal-token-design.md) Accepted；[sprint/2026-05-14-edge-layer.md](docs/sprint/2026-05-14-edge-layer.md) |
| 2026-05-20 | 邮箱 + 密码鉴权落地（user-account Phase 1-6）：email/password 登录注册、账户子路由、emailIndex、软删注销；apps/api 218/218 + apps/server 24/24 绿 | [docs/audit/user-account-2026-05-20.md](docs/audit/user-account-2026-05-20.md) |
| 2026-05-21 | 对话延迟诊断 + 修复（主 LLM 路由收紧）；记忆门控 `FEATURE_MEMORY_THROTTLE` + 记忆治理（真删 / 滚动压缩去重 / 画像快照） | [chat-latency-fix](docs/audit/2026-05-21-chat-latency-fix-report.md) / [memory-channel-audit](docs/sprint/2026-05-21-memory-channel-audit.md) |
| 2026-05 | 抽出 `@yelan/llm` 共享包（provider/router/pricing/sanitizer/stream-guard）；apps/api·apps/server 各留 `create-router.ts` | [docs/structure.md](docs/structure.md) v0.8.0 |
| 2026-05-27 | 会员 mock 闭环：套餐配置、模拟订阅激活、订阅赠烛、有效会员跳过免费截断、后台人工开通/取消、前端续夜抽屉接真实 mock 接口 | [docs/audit/2026-05-27-membership-mock-subscription.md](docs/audit/2026-05-27-membership-mock-subscription.md) |
