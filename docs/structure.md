# 夜阑 · 工程结构

> **Version**: 0.8.9
> **Last updated**: 2026-07-30
> **维护要求**: 任何修改项目结构的改动都必须在同一 PR 内更新本文档并 bump version。具体规则见末尾的"维护规则"。
>
> **0.8.9 变更**（patch — token 硬闸总开关）：`services/token-guard.ts` 加 `TOKEN_GUARD_ENABLED` 环境开关（代码默认 on、`!== 'off'` 仅可显式关；`checkTokenBudget` off 时首行直接返回 `{allowed:true}`，不触碰全局/会话上限逻辑）；`infra/deploy/docker-compose.yml` + `.env.example` 加 `TOKEN_GUARD_ENABLED`（部署默认 off）。背景：长会话累计 token 破 `SESSION_TOKEN_LIMIT` 时 `useReal=false` 会静默回退 `mockChatStream()` 脚本台词；关闭硬闸为过渡，长会话降级最终交由上下文压缩按有效上下文大小计（TODO）。
> **0.8.8 变更**（patch — 提示热重载配套 + 默认卡资产 + 排障脚本）：`apps/api/scripts/` 新增手动排障/审计脚本目录（probe-* / audit-* / real-chat-test / verify-wiring，tsx 直跑）；`packages/prompts/prelude-cards/` 新增默认前置卡 md（`daily-default` / `if-default`，由 `services/prelude-cards.ts` 首启 seed）；`apps/api/src/prompts/` 加 `grayscale-effect.test.ts`（验证 Prompt 灰度发布真正回读生效 + 全局约束不丢）；后台 `prompts` 路由更名「Prompt 灰度」→「系统提示编辑器」（发布即下一轮生效 + 版本回滚）；`prompts/loader.ts` + `diagnostics.ts` reload-config 支持免重启热更（模板/策略/边界缓存）。
> **0.8.7 变更**（温度乐观异步切换 + 遥测日志护栏）：后台「策略」加 `TEMPERATURE_OPTIMISTIC` 开关（乐观异步=不阻塞首字、judge 异步供下一轮 / 同步阻塞=回复前 await judge、实时反应本轮）；`store/persistence.ts` 加 `pushBounded` / `LOG_RETENTION` 给只追加遥测数组上界（ADR-0010 迁 PG 前过渡，财务/审计不自动修剪）。

---

## 版本号语义

`MAJOR.MINOR.PATCH`

| 位 | 何时 +1 | 例子 |
|---|---|---|
| MAJOR | 拆分仓库、主框架更换、根目录大重组 | monorepo → polyrepo；React → 别的框架 |
| MINOR | 新增 workspace 包 / 新增顶层目录 / 新增受 ADR 约束的子系统 | 加 `apps/share/`；引入 packages/ui |
| PATCH | 单个 app 内部子目录调整 / 文件命名约定补丁 / stub 类别新增 | 加 `apps/web/src/scenes/Foo.tsx`；改某 README |

---

## 顶层布局

```
夜阑/
├── README.md                  入口文档 — 目录速览 + 文档索引 + 五种"卡住"场景对应表
├── package.json               根 workspace 脚本定义
├── 打开可视化后台.cmd          Windows 双击入口：启动 apps/api 并打开 /admin
├── 打开可视化后台.ps1          上述入口的 PowerShell 主体脚本
├── 快速启动真前端.bat          Windows 双击入口：起 api + 真前端并打开 5173
├── 快速启动真前端.ps1          上述入口的 PowerShell 主体（缺依赖自动 install）
├── pnpm-workspace.yaml        声明 apps/* + packages/* + infra/db 为子包
├── tsconfig.base.json         所有子项目继承的严格 TS 配置
├── .env.example               环境变量模板
├── .gitignore / .editorconfig
│
├── docs/                      文档根（开发文档/结构文档/TODO/ADR/审计/产品手册）
├── prototype/                 原始 React UMD + JSX UI 基线（保留为视觉真理源）
├── apps/                      可独立部署 / 可独立运行的"应用"
├── packages/                  被多个 app 共享的"库"
├── infra/                     基础设施代码（DB / Cloudflare / CI）
└── scripts/                   一键开发 / 工具脚本
```

---

## docs/

| 路径 | 内容 | 维护者 |
|---|---|---|
| `docs/architecture/data-locality.md` | **数据分工表**（本地 vs 服务器，每类数据真理源 / 同步 / 删除） | 工程 Lead |
| `docs/changelog/structure.md` | `structure.md` 历史变更日志；当前结构仍以本文为准 | 工程 Lead |
| `docs/product/产品经理手册.html` | PM 主手册 v0.3 | PM |
| `docs/tech/星座数据格式规范.md` | 星座叠加层**行式 DSL 规范**（坐标域 / 语法 / 校验 / 生成约束 / 反向导出） | 工程 |
| `docs/tech/星座生成器.html` | **独立可交互星座生成器**（叠底图缩放拉伸、手点设星座点、导出/导入 DSL）；零依赖单文件，浏览器直接打开 | 工程 |
| `docs/开发文档.md` | 工程主文档 v0.8（含设计资产/Token 同步/运维 SOP 规划） | 全栈 Lead |
| `docs/TODOlist.md` | 任务追踪（ID 编号体系） | 全员 |
| `docs/tech/architecture-audit.md` | 代码质量 / 完成度 / 风险评估（2026-05-10） | 工程 Lead |
| `docs/tech/adr/template.md` | ADR 模板 | — |
| `docs/tech/adr/0001-monorepo-layout.md` | 选 pnpm monorepo 三段式 | 工程团队 |
| `docs/tech/adr/0002-unlim-worker-standalone.md` | unlim-worker 独立部署 | 工程团队 |
| `docs/tech/adr/0003-prototype-as-ui-baseline.md` | prototype/ 作为 UI 基线 | 工程团队 |
| `docs/tech/adr/0004-db-migration-tool.md` | 纯 SQL + 自建 runner + GUI | 工程团队 |
| `docs/tech/adr/0005-account-bound-state.md` | **取代"记忆零服务端"** — 长期记忆 + UI 偏好上服务器，账号绑定 | PM + 工程 |
| `docs/tech/adr/0006-mock-server-direct-nvidia.md` | 本地 mock-server 直连 NVIDIA，不走 wrangler dev | 工程团队 |
| `docs/tech/adr/0007-linked-server-mock-fallback.md` | 本地新后端入口代理 mock-server 缺口功能；仅限本地/测试 | 工程团队 |
| `docs/tech/adr/0008-deployment-shape-decision.md` | 上线形态决策：`apps/server` 做 Worker edge 层，`apps/api` 做 Node 主后端 | 架构 + PM |
| `docs/tech/adr/0009-internal-token-design.md` | Edge ↔ Node 主后端互验的 `INTERNAL_TOKEN` 设计 | 架构 + PM + 运维 |
| `docs/tech/adr/0010-persistence-postgres-decision.md` | Postgres 持久化决策：生产替换 `.local/state.json` | 架构 + PM |

---

## prototype/

原始 React UMD + Babel standalone 的 JSX 实现，**目标 UI 的视觉真理源**。打开 `prototype/夜阑.html` 即可演示，无需构建。
不允许在此目录加新功能；新功能去 `apps/web/`。等 `apps/web/` 全量覆盖后整体移到 `docs/prototype-snapshot/` 归档。

| 文件 | 对应 apps/web 位置 |
|---|---|
| `app.jsx` | `apps/web/src/App.tsx` |
| `intro.jsx` | `scenes/IntroScene.tsx` + `OpeningScene.tsx` + `CharacterSelect.tsx` |
| `scenes.jsx` | `scenes/Conversation.tsx` + `NarrativeCutoff.tsx` |
| `dialogue.jsx` | `components/conversation/*` |
| `drawer.jsx` | `components/drawer/*` |
| `particles.jsx` | `components/particles/ParticleField.tsx` |
| `tweaks-panel.jsx` | `components/tweaks/TweaksPanel.tsx` |
| `README.md` | 原型使用说明（含文件映射表） |

---

## apps/

每个子目录是一个独立的 workspace package（`@yelan/<name>`），可独立 `pnpm dev` / `pnpm build`。

### apps/web/ — 主前端 SPA

技术栈：React 18 + Vite + TypeScript + CSS Modules + Zustand + React Query + Dexie。

```
apps/web/
├── package.json / vite.config.ts / tsconfig.json / index.html
└── src/
    ├── main.tsx                  入口（QueryClientProvider）
    ├── App.tsx                   场景编排
    ├── vite-env.d.ts             Vite 环境变量类型
    ├── styles/
    │   ├── reset.css
    │   ├── tokens.css            CSS variables（手写镜像，待自动从 design-tokens 派生）
    │   └── globals.css           全局 keyframes
    ├── scenes/                   intro / opening / select / chat / end 五场景；Conversation 按 structured parts 段落级输出
    ├── components/
    │   ├── conversation/         NarrationText / DialogueText / GlowSentence / ExitFadeLayer / TypingDots + index.ts barrel
    │   ├── drawer/               DrawerRail / DrawerShell / index.ts barrel + panels/{8 个面板} + panels/index.ts barrel
    │   ├── particles/            背景粒子
    │   ├── tweaks/               TweaksPanel + TweakButton / TweakSection / TweakSelect / TweakSlider（dev-only 调参面板）
    │   └── achievement/          AchievementFlash（成就闪屏）
    ├── hooks/                    useTweaks / useSSE / useChat
    ├── chat/                     local-history.ts（按角色 localStorage 本机会话快照）+ local-history.test.ts
    ├── stores/                   sessionStore / chatStore / candleStore / drawerStore / quotaStore / preferencesStore（Zustand）
    ├── api/                      client / sse / auth（otp/verify + email/password 登录注册 + bind）/ billing / characters / achievements / surveys / events / memories / preferences
    ├── memory/                   db.ts(Dexie) + embedder.worker.ts + recall.ts + sync.ts(Dexie↔服务端双向同步) + keyword-fallback.ts(BM25降级) + README.md
    ├── lib/                      candle-state / sentence-buffer / stage-detector / clear-local-user-data（登出·换号·删号·撤销全部会话统一清本机：chatSession.* + memory.since 游标 + Dexie）
    └── config/                   env / feature-flags
```

### apps/server/ — Cloudflare Worker edge 层

> 按 ADR-0008，`apps/server` 是生产入口的 edge 层，不再承担 Node 主后端业务实现。
> 它负责静态资源 / `/admin` SPA、边缘鉴权、rate-limit、CORS 与 security headers；
> `/api/*` 通过 `mock-fallback.ts` 转发到 `apps/api`（`MOCK_SERVER_BASE`，HTTPS + 内部 token）。

技术栈：Hono + Cloudflare Workers + KV（rate-limit）+ edge middleware + apps/api fallback。

```
apps/server/
├── README.md
├── package.json / tsconfig.json / wrangler.toml
└── src/
    ├── index.ts                  Hono entry，挂 edge middleware + 现存路由；缺口交给 mock-fallback
    ├── types.d.ts                Workers / 测试环境补充类型
    ├── __tests__/                admin-auth / cors / mock-fallback / rate-limit / security-headers
    ├── routes/
    │   ├── auth.ts               edge 侧 auth 入口
    │   ├── chat.ts               POST /api/chat (SSE)
    │   ├── mock-fallback.ts      /api/* → apps/api；注入内部 token，强制生产 HTTPS
    │   ├── admin/index.ts        admin 路由挂载入口 + admin-auth
    │   └── pay/
    │       ├── index.ts          支付回调挂载入口
    │       ├── wechat.ts
    │       ├── alipay.ts
    │       └── stripe.ts
    ├── middleware/               admin-auth / auth / cors / error / rate-limit / request-id / security-headers
    ├── llm/
    │   ├── create-router.ts      从 env 构造 @yelan/llm 的 LlmRouter（provider/router/types/pricing/sanitizer 全在 `@yelan/llm`）
    │   ├── prompt-cache.ts       Anthropic ephemeral cache helper
    │   └── context-compress.ts   长对话压缩
    ├── prompts/                  loader.ts（先查 KV 后回退到 @yelan/prompts）+ assemble.ts
    ├── pipeline/                 cost-tracker / handle-chat-turn / memo-extractor / moderation
    ├── services/                 billing / payment / auth / achievements / surveys / characters / if-line / logs
    ├── db/                       client.ts(PG TODO) + redis.ts(Upstash TODO) + repositories.ts（Workers 路线预留）
    ├── observability/            events / metrics / alerts
    ├── config/                   AppConfig
    └── types/bindings.ts         Workers Env 绑定
```

### apps/unlim-worker/ — NVIDIA 限制解除器

独立部署的 Cloudflare Worker，是夜阑 LLMRouter 的主模型路径之一（ADR-0002）。  
保留原项目结构（`src/{config,nvidia,unlim,worker}.js` + `wrangler.toml`），另含 `LICENSE`（原项目许可证）与 `README.md`（使用说明），新增 `INTEGRATION.md` 说明在系统中的位置。

### apps/api/ — Node 主后端（容器化生产后端，前身 apps/mock-server）

Node + Hono，是业务 API 与真实 LLM 流式的主后端；`apps/server` 按 ADR-0008 只做 edge 守门与 fallback，不再逐项镜像业务路由。前端通过 `VITE_USE_MOCK=true`（默认）切到这里，无需 wrangler / Cloudflare 账号即可全栈联调，仅需在根 `.env` 填一个 LLM API key 就能直接对话。

```
apps/api/src/
├── index.ts                  serve(8787) — 挂载所有路由 + /health 报告 LLM / sidecar 就绪
├── bootstrap-env.ts          先于一切 import 加载根 .env（手写解析，无 dotenv 依赖）
├── types.d.ts                Node / 测试环境补充类型
├── __tests__/                account-mgmt / auth / character-import / character-profile-sections / chat / email-auth / events / gray / internal-token / membership / memory-gate-integration / me / p1-regressions / password / surveys
├── config/
│   ├── deploy-mode.ts        local/server 部署 profile + 启动前自检
│   └── feature-flags.ts      灰测 / 功能开关读取
├── routes/
│   ├── chat.ts                   POST /api/chat (SSE) — 薄路由：未知 sessionId 自动 upsert 会话后委托 pipeline/chat-pipeline.ts
│   ├── auth.ts                   /api/auth/{otp,verify,me} + /password/{login,reset} + /email/{register,login}（已注销账号 verify 返 410）
│   ├── billing.ts                /api/billing/{plans,subscription,subscribe,candle,candle/ledger,quota}
│   ├── characters.ts             /api/characters{,/:id,/:id/unlock,/me/list}
│   ├── sessions.ts               /api/sessions{,/recent,/:id/messages}
│   ├── achievements.ts           /api/achievements{,/me}
│   ├── surveys.ts                /api/surveys/{active,/:id/submit}（dwell ≥ 5s 校验）
│   ├── events.ts                 /api/events 埋点回收
│   ├── logs.ts                   /api/logs/conversation
│   ├── if-codes.ts               /api/if-codes/redeem（不显式提示命中）
│   ├── me.ts                     /api/me（softAuth）+ /name；requireAuth 子路由：/password、/profile、/email/bind、/phone/change、/sessions/revoke-all、/delete；另挂 /characters、/achievements、memories/preferences
│   ├── me/
│   │   ├── memories.ts           /api/me/memories — 增量同步 / 批量 upsert / 软删 / recall + 画像快照 profile（snapshot+facts）；真·遗忘连画像/概要一起清（BE-102 + 记忆治理）
│   │   └── preferences.ts        /api/me/preferences — UI 偏好读写（BE-103）
│   ├── pay/
│   │   ├── index.ts              路由挂载入口
│   │   ├── _helpers.ts           processMockPay：幂等入账 + 烛账增减
│   │   ├── wechat.ts / alipay.ts callback
│   │   └── stripe.ts             webhook
│   └── admin/
│       ├── index.ts              ADMIN_TOKEN 鉴权（默认 admin-dev-token）
│       ├── _audit.ts             所有写动作落 adminAudit
│       ├── health.ts             /api/admin/health 概览聚合（含 sidecar.ready）
│       ├── diagnostics.ts        /api/admin/diagnostics 体检聚合（schema 与 scripts/doctor.mjs 对齐）；reload-config 重读 .env + 清 flag/router/prompt 缓存（含 loader 模板/策略/边界），不重启进程
│       ├── seed.ts               /api/admin/seed 一键灌示例
│       ├── config.ts             env 读写 + 运行期覆盖 + LLM 测试连接
│       ├── if-codes.ts           暗号 CRUD + 兑换记录（氛围判断命中后温度=5）
│       ├── llm-apis.ts           LLM API 库存 / 分槽配置
│       ├── prelude-cards.ts      Prelude cards CRUD / 灰测配置
│       ├── sidecar-config.ts     侧袋 AI 运行配置
│       ├── sidecar-prompts.ts    5 个侧袋 AI prompt 查看/修改/审计
│       ├── audit.ts              审计日志查询
│       ├── sessions.ts           会话调试
│       ├── characters.ts         角色卡 CRUD（DB → yaml fallback；BE-101）+ 粘贴导入 preview/commit（/import/preview、/import；识别 tier2 但不入库，写动作落 character.import 审计）
│       ├── constellations.ts     介绍页星座 CRUD（按 slug；GET/PUT/DELETE，default 回退内置、custom 持久化，写动作落审计）
│       ├── policy.ts             policy_kv 读写 API
│       ├── quota.ts              配额运营 API
│       ├── membership.ts         会员套餐配置 / 人工开通 / 到期不续（mock 订阅）
│       ├── {audit,constellations,health,policy,prompts,quota,sidecar-config,sidecar-prompts}.test.ts + 顶层 character-import / character-profile-sections 测试
│       └── candle / surveys / users / prompts / costs（BE-104）
├── middleware/
│   ├── auth.ts                   requireAuth（bearer）+ requireAdmin（ADMIN_TOKEN）
│   ├── internal-token.ts         ADR-0009 X-Internal-Token 验签
│   ├── request-id.ts             请求级 requestId 注入
│   └── validation.ts             zod validationHook（统一校验错误格式）
├── llm/
│   └── create-router.ts          把 services/llm-api-inventory 的主路由库存喂进 @yelan/llm 的 LlmRouter（provider/router/pricing/think-sanitizer/stream-guard 全在 `@yelan/llm`）
├── sidecar-ai/
│   ├── client.ts                 侧袋 AI 薄调用；可选 `taskKey` 走任务专属渠道（见 services/llm-api-inventory）
│   ├── prompts.ts                5 个默认 prompt；运行时优先读 state.sidecarPrompts；atmosphereJudge 含 V1/V2 双版本，FEATURE_TEMP_V2 选默认
│   ├── atmosphere-judge.ts       氛围温度 1-5；IF 命中只作为 prompt 上下文，不再强制温度下限；日志落 state.temperatureLogs
│   ├── output-structurer.ts      主 AI 输出拆为 dialogue/action/environment/narration；失败回退正则 narration
│   ├── preference-recorder.ts    每 5 次用户输入提取画像，整合为替换式 snapshot（不按日期堆叠）写 userProfiles + 结构化 userProfileFacts/userProfileChangelog；保留显式称呼行；走任务渠道 `preferenceRecorder`
│   ├── quota-ending.ts           额度耗尽时生成自然收束指令；走任务渠道 `quotaEnding`
│   ├── context-compressor.ts     超出最近 15 轮的旧对话滚动压缩为 state.contextSummaries（compressedUntilMessageId 游标增量去重，替换式整合不 --- 堆叠）；走任务渠道 `contextCompressor`
│   ├── orchestrator.ts           侧袋任务编排 + orchestrator.test.ts
│   ├── types.ts                  侧袋内部类型
│   └── {atmosphere-judge,client,orchestrator,output-structurer,state}.test.ts
├── pipeline/
│   ├── chat-pipeline.ts          对话主链路（v0.8.0 从 routes/chat.ts 拆出）：装配 prompt → LlmRouter 流式 → 侧袋（氛围/拆句/偏好/压缩/额度）→ token-guard → 记忆门控
│   ├── memory-gate.ts            shouldInjectMemory：首轮 / stage 切换 / 关系类关键词 / 满 4 轮 才注入 profile+summary+recall（FEATURE_MEMORY_THROTTLE，默认 off）+ memory-gate.test.ts
│   └── boundary.ts               effectiveBoundary + getGlobalBoundary（stage-engine / sentence-segmenter 在 @yelan/shared）
├── prompts/
│   ├── loader.ts                 角色卡走 services/characters（DB 真理源）；strategies/boundaries/system 模板仍读文件（模块级缓存）；resetPromptCache() 供 reload-config 清缓存热更，免重启
│   ├── yaml.ts                   极简 yaml 解析（service seed 与 loader 共用，避免循环依赖）
│   ├── assemble.ts               system prompt + prelude 装配
│   └── {assemble-prelude,grayscale-effect,yaml}.test.ts  grayscale-effect 验证 Prompt 灰度发布回读生效 + 全局约束不丢
├── services/
│   ├── users.ts                 user / candle / quota / 流水 + 邮箱·密码·手机鉴权（getOrCreateUserByPhone / registerWithEmail / loginWithEmail / loginWithPassword / bindEmail / changePhone / deleteAccount / revokeAllSessions；emailIndex 唯一性 + 原子 swap；UserDeletedError / EmailAuthError / AccountError）
│   ├── password.ts              密码哈希（scrypt）+ 强度校验 + 比对（PasswordError）；setPassword / resetPasswordViaOtp
│   ├── characters.ts            角色卡 list/get/upsert/disable/enable/resetFromYaml；首次启动 yaml seed 进 state（BE-101）；含私有 profileSections（注入 prompt，不进公开 Character 类型）；导入链路复用 upsert 写入
│   ├── constellations.ts        介绍页星座按 slug 独立存储：list/get/put/delete；持久化为 custom，缺省回退 @yelan/shared 内置默认（source=custom|default）
│   ├── error-logger.ts          结构化错误日志
│   ├── if-unlock.ts             IF 暗号解锁逻辑
│   ├── llm-api-inventory.ts     LLM API 分槽配置 / 库存读取；含 main / sidecar / sidecarTaskApiIds 三级路由（任务专用 key 不会被主路由 fallback 捡走）
│   ├── memories.ts              偏好/事件 增量同步 + upsert + 软删 + cosine recall（BE-102）
│   ├── policy.ts                policy_kv 读写 + 类型校验 + 分组 + 缓存（BE-104）
│   ├── policy-definitions.ts    policy 默认值定义表
│   ├── membership.ts            月光 / 星河 / 永夜 mock 订阅服务：套餐配置、赠烛、有效会员判定
│   ├── prelude-cards.ts         prelude cards 配置服务
│   ├── token-guard.ts           token / 额度守门（会话累计 + 全日上限）；`TOKEN_GUARD_ENABLED=off` 可整体关闭（默认 on，off 时 checkTokenBudget 直接放行）
│   └── {if-detect,if-multiaccount,if-prelude-scope,llm-api-inventory,memories,membership,policy}.test.ts
├── store/
│   ├── persistence.ts            JSON 文件持久化；state 含 emailIndex / membershipPlans / subscriptions / sidecarPrompts / userProfiles / userProfileFacts / userProfileChangelog / contextSummaries / temperatureLogs；PersistedUser 加 passwordHash·tokenVersion·deletedAt·email·nickname·avatarUrl·bio·conversationRounds，SessionRow 加 lastMemoryRound；normalizeLoadedState 兜底回填 emailIndex / conversationRounds / membership 容器；自动快照 + 损坏隔离 + 快照恢复
│   └── persistence.test.ts       快照列举/修剪 + 损坏隔离/恢复路径单测
├── fixtures/                     billing / characters / achievements / surveys / me（公开数据）
└── stream/mock-sse.ts            脚本化 SSE — 无 API key 时 fallback 用
```

> **持久化路径**：`apps/api/.local/state.json`（gitignore 友好）。删除即重置。运行时自动快照落 `apps/api/.local/snapshots/`（`snapshot-*.json` 保留 12 份、节流 30 分钟）；`state.json` 解析失败时坏文件隔离为 `corrupt-*.json`（保留 5 份）并从最近可用快照恢复，绝不静默清空。`.local/` 整体 gitignore。

> **`apps/api/scripts/`**（手动排障 / 审计脚本，`tsx` 直跑，不进生产路径）：`probe-{10rounds,memory-gate,recharge-quota}.ts`（对话轮次 / 记忆门控 / 充值配额探针）、`audit-{prompt,grayscale-e2e}.ts`（system prompt 装配审计 / Prompt 灰度端到端）、`real-chat-test.ts`（真实 LLM 冒烟）、`verify-wiring.ts`（路由/服务接线自检）。

### apps/admin/ — 运营后台

React 后台已落地为 `/admin` 的优先入口；旧 `console.html` 保留为 `/admin-legacy` DevOps 视图。
本地 apps/api 托管入口：`http://127.0.0.1:8787/admin`；新后端联动入口：`http://127.0.0.1:8789/admin`。

```
apps/admin/
├── src/              React 后台（23 个 routes 组件 + registry；含 CharacterImportDialog 辅助弹窗、ConstellationEditor、constellation-dsl 纯函数解析器/序列化器 + 单测）
├── dist/             构建产物；apps/api 静态托管时优先加载
├── console.html      旧版 17 面板后台；/admin-legacy 保留；已冻结，只修安全/入口兼容/文案
└── README.md         面板清单 + 扩展指南
```

React 后台当前覆盖 23 个路由组件：总览 / 一键向导 / 健康检查 / 诊断 / API 仓库 / LLM 测试 / 对话测试 / 用户管理 / 角色卡 / 星座编辑器 / 策略 / 会员 / 前置提示卡 / 系统提示编辑器（原「Prompt 灰度」，编辑并发布主 AI 系统提示各段：系统模板 / 边界 B1–B5 / 阶段策略 / 角色卡，发布即下一轮生效 + 版本回滚） / 侧袋 Prompt / IF 暗号 / 问卷 / 烛账 / 配额 / 成本统计 / 会话 / 审计日志 / 支付测试。`Characters.tsx` 额外挂 `CharacterImportDialog.tsx` 作为角色包粘贴导入弹窗。`registry.ts` 另保留 `db-tools` 入口作为 infra/db GUI 外链。
旧版 17 个面板：一键向导 / 概览 / 服务配置 / LLM / 用户 / 烛账 / 配额 / 问卷 / Prompt 灰度 / 成本 / IF 暗号 / **侧袋 AI** / **角色卡** / 审计 / 会话 / 支付测试 / DB 工具直链。该文件已冻结，不再新增业务面板或产品能力。

> React 后台不等于生产后台完成：当前 admin API 仍主要来自 apps/api；`pnpm dev:server` 只是通过 server fallback 代理过去。

### apps/share/ — 长图分享子站

占位 README。Phase 1 W10 起开发。Next.js + 服务端截图。

---

## packages/

被多个 app 引用的库代码。所有都是 `private: true` workspace 包。

### packages/shared/ — 类型 / Schema / 常量

**前后端类型唯一真理源**。任何业务对象的 TS 类型只在这里定义。

```
packages/shared/src/
├── index.ts                  re-export 全部
├── constants.ts              DAILY_FREE_ROUND_LIMIT 等
├── enums/                    stage / boundary / candle-state / candle-reason / quota-reason / subscription-plan / if-state
├── types/                    user / character（含 constellation? 字段）/ constellation / session / candle / quota / subscription / achievement / survey / log / recall / telemetry / chat / sidecar
├── data/                     constellations（内置默认星座数据集，按角色 slug；web 渲染缺省回退 + admin 编辑起点）
├── schemas/                  chat / auth / survey / sidecar / error（zod 请求/事件校验）
├── contracts/                achievements / admin / auth / billing / characters / chat / if-codes / logs / me / sessions / survey（前后端接口契约 + 响应 schema，含邮箱/密码/画像快照；characters/admin 含星座 ConstellationSchema、角色导入 AdminCharacterImport* schema + normalizeCharacterImportBundle；admin 覆盖 LLM API / prompt 发布回滚 / sidecar config / surveys 后台写入契约；admin.test 覆盖导入归一化）
├── pipeline/                 boundary / stage-engine / sentence-segmenter（纯函数，前后端共用：effectiveBoundary / judgeStage / isSentenceEnd / maybeGlow）
├── prompts/render.ts         system prompt 渲染辅助
└── repository/               持久化抽象的类型/接口预留（Postgres 路线）
```

### packages/llm/ — LLM 层（workspace 包 `@yelan/llm`）

**前后端共享的 LLM 抽象真理源**（v0.8.0 从 `apps/api/src/llm` 与 `apps/server/src/llm` 上提）。provider 协议、路由、计价、`<think>` 过滤、流守门只有这一份；`apps/api` 与 `apps/server` 都 `import ... from '@yelan/llm'`，各自只保留一个 `create-router.ts` 把库存配置喂进 `LlmRouter`。仅依赖 `@yelan/shared`。

```
packages/llm/
├── package.json / tsconfig.json
└── src/
    ├── index.ts             公开 API（LlmRouter / createRouterFromEnv / provider 工厂 / pricing / sanitizer / stream-guard）
    ├── types.ts             LLMProvider / CompletionRequest / CompletionChunk 抽象
    ├── config.ts            LlmProviderConfig / LlmRouterConfig
    ├── router.ts            LlmRouter（按 stage 选 provider + fallback 链）
    ├── providers/{anthropic,openai,deepseek,nvidia-unlim}.ts  真实 SSE 流式 + OpenAI 兼容工厂
    ├── pricing.ts           provider/model 价格表 + estimateInputTokens
    ├── think-sanitizer.ts   过滤 <think> 推理块（含 SanitizerStats）
    └── stream-guard.ts      流式守门（空回复/截断分类）
```

### packages/prompts/ — Prompt as Code

PM / Prompt 工程师改 yaml/md，构建期由 `scripts/build.ts` 烘成 `src/generated.ts` 供 server 直接 import。
运行时优先从 KV 读灰度版本（`apps/server/src/prompts/loader.ts`），KV miss 才回退到这里。

```
packages/prompts/
├── package.json / tsconfig.json / index.ts / README.md
├── characters/{shen-yan-zhi,jiang-bai}.yaml
├── strategies/stage_{daily,rise,climax,after,end}.md
├── boundaries/b{1..5}_*.md
├── prelude-cards/{daily-default,if-default}.md  默认前置卡文案；apps/api services/prelude-cards.ts 首启 seed 进 state.preludeCards
├── system.template.md        系统模板；含 [全局表达约束] + [反八股·去模板化写作规范]（所有对话态生效，不受 IF 换前置卡影响）；必需槽位 {{atmosphere_block}}/{{boundary_clause}}
├── scripts/build.ts          构建器（支持 --watch）
└── src/generated.ts          自动生成 — 不要手改
```

### packages/design-tokens/ — 设计 Token

颜色 / 字体 / 字号 / stage 布局 / 关键句停顿等的单一真理源。`apps/web` 与未来的 `apps/share` 共用。

```
packages/design-tokens/
├── package.json / README.md
└── src/
    ├── tokens.ts             TS 导出（代码消费）
    └── tokens.css            CSS 变量（手写镜像，TODO 自动生成）
```

---

## infra/

基础设施代码，不直接服务用户但服务工程师。

### infra/db/ — DB 迁移工具（workspace 包 `@yelan/db`）

ADR-0004 决策：纯 SQL + 自建 Node runner + 浏览器 GUI。

```
infra/db/
├── package.json / tsconfig.json / README.md
├── schema.sql                完整 schema 快照（人读用，不直接 apply）
├── migrations/
│   ├── 0001_init.sql         初始 schema
│   ├── 0002_characters.sql   角色卡表
│   ├── 0003_user_memories.sql
│   ├── 0004_user_ui_preferences.sql
│   ├── 0005_policy.sql
│   ├── 0006_character_profile_sections.sql
│   ├── 0007_default_user_boundary_3.sql
│   └── 0008_user_preference_category.sql
└── src/
    ├── client.ts             postgres-js 连接 helper
    ├── runner.ts             核心：listMigrations / status / up / newMigration / reset / listTables / runQuery
    ├── cli.ts                CLI 入口（status / up / new / reset）
    └── gui/
        ├── server.ts         Hono Node 服务（端口 5174）
        └── index.html        单页 GUI（5 个面板：状态 / 新建 / 表 / 查询 / 危险区）
```

### infra/deploy/ — 服务器一键部署

apps/api 走 Node + Docker 的生产路径（vs `apps/server` 的 Cloudflare Workers 路径）。
让"本机 / 服务器"两套部署共用同一份代码，只切 `DEPLOY_MODE`。

```
infra/deploy/
├── Dockerfile           Node 20-alpine + pnpm + tsx；ENV DEPLOY_MODE=server
├── docker-compose.yml   apps/api + caddy 两容器；持久化卷 _data/
├── Caddyfile            自动 HTTPS + /api/* + SSE flush_interval -1；控制台秘密入口 {$ADMIN_PATH} 改写转发，/admin* 装死成 landing，放行 /admin/assets/*
├── .env.example         DOMAIN / ADMIN_TOKEN / CORS_ORIGINS / LLM keys / ADMIN_PATH（控制台秘密路径）/ TOKEN_GUARD_ENABLED（token 硬闸开关，部署默认 off）
├── check.sh             ECS 部署前防呆检查（占位域名 / token 强度 / LLM key / 内部 token / ADMIN_PATH 秘密路径）
├── .gitignore           忽略 .env 和 _data/
└── README.md            一句话部署 + 备份 / 安全 / 升级
```

部署：`pnpm deploy:up`（=`docker compose up -d --build`）。

### infra/cloudflare/

`README.md` 占位 — 列 Workers / KV / R2 / Secrets 清单和部署步骤（Phase 1 W5+）。

### infra/ci/

GitHub Actions：

- `infra/ci/github/workflows/ci.yml` — typecheck + test
- `infra/ci/github/workflows/deploy.yml` — 主分支自动部署 server / unlim

---

## scripts/

| 脚本 | 用途 |
|---|---|
| `doctor.mjs` | **零依赖体检**：Node/pnpm/.env/服务/资产 共 10 项；输出 `--json` 与 `/api/admin/diagnostics` 同 schema |
| `setup.mjs` | **交互式初始化**：拷 `.env.example→.env`、问 API key、`pnpm install`；幂等 / 不破坏已有 key |
| `seed-data.mjs` | **一键灌示例**：HTTP 调 `/api/admin/seed`（apps/api 必须在跑） |
| `start.mjs` | **跨平台模式启动器**：`node scripts/start.mjs local\|server\|full`；设 `DEPLOY_MODE` 后转交 pnpm |
| `dev-server-linked.mjs` | **新后端联动启动器**：复用/启动 apps/api:8787，并启动 apps/server:8789，开启 mock fallback |
| `dev.ps1` / `dev.sh` | **一条龙**：检查 pnpm + node_modules → `pnpm doctor` → `pnpm dev` |
| `check-api-contracts.mjs` | **接口纪律检查**：扫描禁用模式，防止契约漂移；支付接口暂列 deferred，不计入当前补齐范围 |
| `gray-snapshot.mjs` / `gray-reset.mjs` | **灰测状态快照 / 回滚**：辅助灰测前后恢复本地状态 |
| `prune-llm-apis.mjs` | **LLM API 库存清理**：默认预演，`--apply` 才写入并备份 |
| `bench-structurer.mjs` / `bench-structurer-horoe.mjs` | **结构化输出基准**：对比 sidecar structurer 效果 / 延迟 |
| `bench-reasoning.mjs` | **主模型 reasoning_effort A/B 基准** |
| `cache-poc.mjs` | **Prompt cache POC**：验证缓存行为 |
| `seed-data.ts` | TODO：把 mock fixtures 灌进真实 PG（Phase 1） |
| `prompt-playground/README.md` | TODO：Prompt 重放 / 评分（修订 #20 飞轮） |

## 根目录便捷脚本

| 脚本 | 用途 |
|---|---|
| `打开可视化后台.cmd` | Windows 双击入口；调用同名 `.ps1` |
| `打开可视化后台.ps1` | 若 8787 `/health` 不通则启动 `pnpm dev:mock`，轮询就绪后打开 `http://127.0.0.1:8787/admin` |

---

## 根脚本（package.json）

| 脚本 | 作用 |
|---|---|
| `pnpm setup` | **首跑** — 拷 .env / 问 key / install |
| `pnpm doctor` | **体检** — 10 项检查；`--json` 给 CI / wizard |
| `pnpm seed` | **灌示例** — 调 apps/api 建 3 用户 + 暗号 + 支付 |
| `pnpm start:local` / `start:server` / `start:full` | **一键切部署模式** — 通过 scripts/start.mjs 设 DEPLOY_MODE |
| `pnpm deploy:up` / `deploy:down` / `deploy:logs` / `deploy:ps` | **服务器侧** — docker compose 一键起 / 停 / 看 |
| `pnpm dev` | 同时起 apps/api + web |
| `pnpm dev:check` | doctor 通过后再 dev（失败阻断） |
| `pnpm dev:server` | 新后端联动模式：apps/api 8787 + apps/server 8789 |
| `pnpm dev:server:raw` / `dev:web` / `dev:mock` / `dev:unlim` | 单跑某个 app；`dev:server:raw` 直接启动 `apps/server` Worker edge 层 |
| `pnpm build` | 先 prompts:build，再级联 build 所有 app |
| `pnpm typecheck` / `lint` / `format` / `test` | 全仓 |
| `pnpm prompts:build` / `prompts:watch` | Prompt 资产烘焙 |
| `pnpm db:status` / `db:up` / `db:new` / `db:reset` / `db:gui` | 数据库迁移 |

---

## 关键工程约定（不要打破）

1. **Prompt 不在代码里** — 全部进 `packages/prompts/`，改 prompt 不改 TS。
2. **类型只有一份** — 业务类型只在 `packages/shared/` 定义；apps 通过 re-export 用。
3. **后端职责分层** — `apps/api` 是业务 API 真理源；`apps/server` 是 Worker edge 层，只放静态入口、边缘鉴权、rate-limit、CORS/security headers 与 fallback。新增业务路由默认只进 `apps/api`，只有边缘策略变化才同步改 `apps/server`。
4. **合规开关只动配置** — `narrative_boundary_global` 在 wrangler.toml / env，不分散到代码。
5. **服务器是数据真理源** — 长期记忆（preferences / events）+ UI 偏好（暗色/字号）+ 烛账 / 会话 全部账号绑定上行；客户端 Dexie + transformers.js 仅做缓存 + 嵌入计算。前端 `localStorage` 只保存按角色的本机会话快照，用于当前设备续聊；"清除本机对话"只删本地快照并换新 `sessionId`，不删除服务器会话/记忆/暗号状态。见 [ADR-0005](docs/tech/adr/0005-account-bound-state.md) 取代旧"记忆零服务端"原则；分类对照见 [docs/architecture/data-locality.md](docs/architecture/data-locality.md)。
6. **设计 token 单一来源** — `packages/design-tokens/` 是真理源，CSS 变量是它的镜像。
7. **结构变更必须改文档** — 见下方维护规则。
8. **DB 结构变更必须走迁移文件** — 不允许在代码里直接 `ALTER TABLE`，临时调试用 GUI 的"写入模式"，但事后必须补迁移文件。
9. **侧袋 AI 保持薄实现** — 侧袋任务在 `apps/api/src/sidecar-ai/`；后台只提供 5 个 prompt 文本框和审计，不恢复 `agent_config` / `#agents` 重型平台。
10. **LLM 层只有一份** — provider 协议 / 路由 / 计价 / `<think>` 过滤 / 流守门只在 `packages/llm`（`@yelan/llm`）。`apps/api` 与 `apps/server` 不得各自复制 provider 实现，只能 `import ... from '@yelan/llm'` 并各保留一个 `create-router.ts` 注入库存配置。

---

## 维护规则（强制）

> **任何对项目结构的修改 = 同一 PR 内必须更新本文档**

需要更新本文档的改动包括（不限于）：

- 新增 / 删除 / 移动顶层目录或 workspace 包
- 新增 / 删除 / 移动单个 app 内的子目录或主要文件类别
- 改根 `package.json` 的脚本（增/删/改命令）
- 引入新的依赖类别（如新引入一个数据库 / 队列 / 监控 SaaS）
- 增 / 改 / 废止 ADR
- 改"关键工程约定"

操作步骤：

1. 改完代码后回到本文件，同步对应章节
2. 在末尾"变更日志"加一行
3. 顶部 `Version` 按语义号 bump
4. 顶部 `Last updated` 改成当天
5. 提交一并入 PR

PR review checklist 必须包含一项："`structure.md` 已同步更新"。

---

## 变更日志

历史结构变更已拆到 [docs/changelog/structure.md](changelog/structure.md)。本文件只保留当前结构，避免当前目录说明被历史记录淹没。
