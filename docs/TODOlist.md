# 夜阑 · TODO list

> **基线**：v0.6.3（mock-server + console.html + setup wizard + 一键切换部署 + ADR-0005 全量上行）
> **合并自**：旧 `优化.md`（结构优化建议）+ `待完善功能.md`（14 条要求审计）
> **维护规则**：见末尾 §六

---

## §一　ID 编号约定

每项任务一个稳定 ID，提交里可引用（如 `BE-101: add character CRUD`）。

| 前缀 | 含义 |
|---|---|
| `BE-` | 后端（apps/api / 路由 / DB / 服务） |
| `FE-` | 前端（apps/web） |
| `AD-` | Admin 控制台（apps/admin/console.html） |
| `INFRA-` | 基础设施 / 部署 / CI |
| `OPT-` | 优化 / 重构（不增功能，纯改善结构） |
| `DOC-` | 文档 / ADR |
| `TEST-` | 测试覆盖 |

类型：

- 🔴 **硬性缺失**（缺它就不能 ship 当前阶段定位）
- 🟡 **优化**（已能 ship 但应改）
- 🔵 **新功能**（产品上的扩展，不阻塞）

---

## §二　总览矩阵（一表知全貌）

| ID | 优先级 | 类型 | 标题 | 领域 | 状态 |
|---|---|---|---|---|---|
| BE-101 | P0 | 🔴 | 角色卡 DB 化 + CRUD | 后端 | ✅ done in v0.6.6 |
| BE-102 | P0 | 🔴 | 长期记忆上服务器（preferences/events） | 后端 | ✅ mock done in v0.73.510.16 |
| BE-103 | P0 | 🔴 | UI 偏好上服务器（暗色/字号/调参） | 后端 | ✅ mock done in v0.73.510.16 |
| BE-104 | P0 | 🔴 | 用量规则中央化（policy 表） | 后端 | ✅ mock done in v0.73.510.16 |
| BE-105 | — | — | ~~multi-agent 架构（agent_config 表）~~ → 侧袋 AI 替代 | 后端 | 废弃，见 BE-121~125 |
| BE-106 | P1 | 🔵 | 用户画像聚合 / 仪表盘 API | 后端 | 待办 |
| BE-107 | P2 | 🟡 | apps/api → Postgres 切换层 | 后端 | 待办 |
| BE-108 | P3 | 🟡 | server 入口 routes barrel | 后端 | 待办 |
| BE-121 | P0 | 🔴 | 侧袋 AI — 氛围判断（atmosphere-judge） | 后端 | ✅ done in v0.74.510.19 |
| BE-122 | P0 | 🔴 | 侧袋 AI — 结构拆句（output-structurer） | 后端 | ✅ done in v0.74.510.19 |
| BE-123 | P0 | 🔴 | 侧袋 AI — 偏好记录（preference-recorder） | 后端 | ✅ done in v0.74.510.19 |
| BE-124 | P0 | 🔴 | 侧袋 AI — 额度结束（quota-ending） | 后端 | ✅ done in v0.74.510.19 |
| BE-125 | P0 | 🔴 | 侧袋 AI — 上下文压缩（context-compressor） | 后端 | ✅ done in v0.74.510.19 |
| BE-126 | P0 | 🔴 | 侧袋 AI 集成进主对话链路（chat.ts 改造） | 后端 | ✅ done in v0.74.510.19 |
| BE-115 | P2 | 🔴 | 服务端字段级加密静态（ADR） | 后端 | 待办 |
| FE-110 | P0 | 🔴 | 本地 Dexie ↔ 服务端双向同步 | 前端 | ✅ done in v0.73.510.16 |
| FE-111 | P0 | 🔴 | UI 偏好 store + 启动拉服务端 | 前端 | ✅ done in v0.73.510.16 |
| FE-112 | P1 | 🔵 | "我的画像" 抽屉页 | 前端 | ✅ done（2026-05-21；MemoryPanel 展示画像 snapshot + active facts，来自 `/api/me/memories.profile`） |
| FE-113 | P1 | 🔵 | "忘了一切" 真删按钮 | 前端 | ✅ done（2026-05-21；forget-all 真删画像/preferences/events/概要并写审计） |
| FE-114 | P2 | 🟡 | shared 包 barrel + 删 web/types/index.ts | 前端 | 待办 |
| FE-115 | P2 | 🟡 | App.tsx 场景 lazy + DrawerShell PANEL_MAP | 前端 | 待办 |
| FE-116 | P2 | 🟡 | components 全量 barrel export | 前端 | 待办 |
| FE-117 | P3 | 🟡 | DrawerId 移到 @yelan/shared | 前端 | 待办 |
| FE-118 | P3 | 🟡 | CSS Modules 一致性 + design tokens 自动生成 | 前端 | 待办 |
| FE-119 | P1 | 🟡 | prototype → apps/web 主体验移植（视觉/动画完整版） | 前端 | 🟡 部分（灰测 P2 已补可用骨架 v0.77.514.14，原型视觉/动画完整版排灰测后 sprint） |
| FE-120 | P0 | 🔴 | useChat 消息状态改 ref/store，消除依赖数组风险 | 前端 | ✅ done in v0.77.514.14（Sprint 2026-05-14；新建 chatStore.ts，6 useState → zustand） |
| FE-121 | P0 | 🔴 | 前端 structured/atmosphere SSE 事件处理 + Conversation UI | 前端 | ✅ done in v0.74.510.19 |
| AD-101 | P0 | 🔴 | `#characters` 角色卡管理面板 | 控制台 | ✅ done in v0.6.7 |
| AD-102 | P0 | 🔴 | `#policy` 用量规则面板 | 控制台 | ✅ done in v0.73.510.16 |
| AD-107 | P0 | 🔴 | 移除 Admin 默认 token fallback | 控制台 | ✅ done in v0.77.514.14（Phase 1 已清理；api/client.ts 无 fallback，本次复核确认） |
| AD-103 | — | — | ~~`#agents` multi-agent 配置面板~~ → 侧袋 AI 替代 | 控制台 | 废弃，见 AD-108 |
| AD-108 | P0 | 🔴 | 后台「侧袋 AI」面板（5 prompt 文本框） | 控制台 | ✅ done in v0.74.510.19 |
| AD-109 | P1 | 🟡 | React 后台角色卡补齐 styleTags / forbiddenPhrases | 控制台 | ✅ done in v0.74.510.19 |
| AD-104 | P1 | 🔵 | `#dashboard` 留存/付费/DAU 仪表盘 | 控制台 | 待办 |
| AD-105 | P2 | 🟡 | `#users` 详情页 + 记忆/偏好查看 | 控制台 | 待办 |
| AD-106 | P3 | 🟡 | 按钮 hover tooltip / 操作说明 | 控制台 | 待办 |
| INFRA-101 | P2 | 🟡 | 备份脚本（state.json + PG） | 运维 | 🟡 部分（`pnpm gray:snapshot/reset` 已落 v0.77.514.14） |
| INFRA-102 | P3 | 🔵 | CI deploy.yml（GitHub Actions） | 运维 | 待办 |
| INFRA-103 | P0 | 🔴 | ESLint + Prettier + CI check | 基础设施 | 🟡 部分（lint + Prettier 已立，verify:gray 已立；CI 仍待） |
| DOC-101 | P0 | 🔴 | 数据分工表（cache vs server）落 docs/architecture | 文档 | ✅ done in v0.6.5 |
| DOC-102 | P2 | 🟡 | 顶层架构图（mermaid） | 文档 | ✅ done in v0.77.514.14（Phase 3 计划批次；mermaid 顶层架构图已落 ADR-0008 §决策章节） |
| DOC-103 | P0 | 🔴 | 灰测卫生 checklist + ADR-0008 上线形态决策 | 文档 | 🟡 checklist done in v0.77.514.14；ADR-0008 待 S1 会议 |
| TEST-101 | P1 | 🔴 | shared/schemas + pipeline 关键模块测试 | 测试 | ✅ done in v0.73.510.16 |
| TEST-102 | P2 | 🟡 | apps/api 路由集成测试 | 测试 | 待办（gray.test.ts 已覆盖关键 9 路由） |
| TEST-103 | P0 | 🔴 | 核心对话流集成测试（SSE + useChat + store） | 测试 | 🟡 SSE smoke + requestId + tokenGuard 已 covered in v0.77.514.14；useChat/store 集成仍待 |
| TEST-104 | P1 | 🔴 | 侧袋 AI 状态持久化 + health 回归测试 | 测试 | ✅ done in v0.74.510.19 |
| TEST-105 | P0 | 🔴 | apps/server 联动 fallback 风险回归 | 测试 | 🟡 部分并入：BE-131 已修 admin 鉴权（v0.77.514.14）；其余 8 场景并入 TEST-107（Phase 2） |
| TEST-106 | P0 | 🔴 | 灰测回归套件（events / admin / SSE / cutoff / FEATURE_REAL_LLM / token-guard / requestId） | 测试 | ✅ done in v0.77.514.14（gray.test.ts 20 项） |
| BE-130 | P0 | 🔴 | 灰测卫生包 — 数据真实化 + 错误统一 + 观测 + 硬闸 | 后端 | ✅ done in v0.77.514.14（详见 `接口审计与TODO.md §四`） |
| BE-131 | P0 | 🔴 | apps/server admin 路由加 requireAdmin（5 min 止血） | 后端 | ✅ done in v0.77.514.14（Sprint Phase 1） |
| BE-132 | P1 | 🟡 | chat cost/tokens 从 provider usage 取（替代 length/2 估算） | 后端 | ✅ done in v0.77.514.14（Sprint Phase 1；pricing.ts + chat.ts:225-302 真消费 chunk.usage） |
| BE-133 | P2 | 🟡 | exchange-toggle 实装 policy_kv 或从 admin UI 下架 | 后端 | ✅ done in v0.77.514.14（Sprint Phase 1；policy-definitions + admin/quota set + characters 读，闭环） |
| BE-134 | P1 | 🔴 | apps/server 14 个业务 stub → `503 BACKEND_UNAVAILABLE` 让 fallback 接管 | 后端 | ✅ done in v0.77.514.14（Sprint 2026-05-14；14 文件删除，routes 22→8） |
| BE-135 | P0 | 🔴 | mock-fallback 生产级守门：`MOCK_SERVER_BASE` 必须 HTTPS、出向带 X-Internal-Token | 后端 | ✅ done in v0.77.514.14（Sprint 2026-05-14） |
| BE-136 | P1 | 🟡 | 边缘 rate-limit 接 Cloudflare KV（首选）/ Upstash | 后端 | ✅ done in v0.77.514.14（Sprint 2026-05-14；60/min/IP 滑动窗口） |
| BE-137 | P0 | 🔴 | 边缘 CORS 白名单化（删 `*`） | 后端 | ✅ done in v0.77.514.14（Sprint 2026-05-14） |
| BE-138 | P1 | 🟡 | 边缘 security headers（CSP / HSTS / X-Frame-Options / X-Content-Type-Options） | 后端 | ✅ done in v0.77.514.14（Sprint 2026-05-14） |
| BE-139 | P2 | 🟡 | `apps/mock-server` → `apps/api` 改名（包名 + 目录 + 脚本 + 文档） | 后端 | ✅ done（包名 `@yelan/api` + 目录 + 根脚本 filter 随 ADR-0008 已改；`docs/structure.md` v0.7.7 同步现行引用收尾） |
| BE-140 | P0 | 🔴 | apps/api 持久化 Postgres 接入（替换 `store/persistence.ts`） | 后端 | 待办（Phase 3） |
| BE-141 | P0 | 🔴 | `state.json` → Postgres 一次性迁移脚本 | 后端 | 待办（Phase 3，与 BE-140 同 sprint） |
| BE-142 | P0 | 🔴 | apps/api 校验 X-Internal-Token（与 BE-135 对端，按 ADR-0009） | 后端 | ✅ done in v0.77.514.14（Sprint 2026-05-14；INTERNAL_TOKEN_REQUIRED=false 向后兼容） |
| BE-143 | P1 | 🔵 | 邮箱 + 密码鉴权（email/password 登录注册 + 账户子路由 + emailIndex + 软删注销） | 后端 | ✅ done（2026-05-20；user-account Phase 1-6，详见 `docs/audit/user-account-2026-05-20.md`） |
| BE-144 | P1 | 🟡 | 记忆注入门控 shouldInjectMemory（`FEATURE_MEMORY_THROTTLE`，默认 off） | 后端 | ✅ done（2026-05-21；`pipeline/memory-gate.ts` + `SessionRow.lastMemoryRound`） |
| BE-145 | P1 | 🟡 | 记忆治理：真·遗忘 + 滚动压缩去重 + 画像替换式快照（facts/changelog） | 后端 | ✅ done（2026-05-21） |
| BE-146 | P2 | 🟡 | 侧袋任务级渠道 + 温度 V2（`FEATURE_TEMP_V2`，IF 温度硬锁清零） | 后端 | ✅ done（2026-05-19；v0.79.517.x） |
| OPT-130 | P2 | 🟡 | 抽出 `@yelan/llm` 共享包（provider/router/pricing/sanitizer/stream-guard 上提） | 重构 | ✅ done（2026-05；apps/api·apps/server 共用，见 structure.md v0.8.0 约定 #10） |
| FE-122 | P1 | 🔵 | LoginScene 邮箱默认 + YouPanel 账户区 + 换号统一清本机数据 | 前端 | ✅ done（2026-05-20；`lib/clear-local-user-data.ts`） |
| AD-110 | P1 | 🟡 | Users 面板补 email / id 列（运营对账用，邮箱不脱敏） | 控制台 | ✅ done（2026-05-20） |
| INFRA-104 | P0 | 🔴 | `wrangler.toml` + `.env` 配 INTERNAL_TOKEN / ENV / CORS_ORIGINS / MOCK_SERVER_BASE | 运维 | ✅ done in v0.77.514.14（Sprint 2026-05-14） |
| INFRA-105 | P0 | 🔴 | Docker 生产 compose（Postgres 容器或 managed PG 接入） | 运维 | 待办（Phase 3） |
| INFRA-106 | P0 | 🔴 | CI pipeline（GitHub Actions：typecheck + verify:gray + 构建 docker + 发布 Worker） | 运维 | 待办（Phase 4） |
| INFRA-107 | P1 | 🟡 | Cloudflare Workers secrets 管理 SOP | 运维 | ✅ done in v0.77.514.14（Sprint 2026-05-14；docs/operations/secrets-management.md） |
| INFRA-108 | P1 | 🟡 | `/health` 接监控告警（UptimeRobot / Cloudflare Healthcheck） | 运维 | 待办（Phase 3） |
| TEST-107 | P0 | 🔴 | 边缘层测试（fallback 守门 / 内部 token / rate-limit / CORS / security headers） | 测试 | ✅ done in v0.77.514.14（Sprint 2026-05-14；server 5 文件 24 tests，接入 verify:gray） |
| TEST-108 | P1 | 🔴 | F3 高频路由单测（chat SSE / auth / events 三件套） | 测试 | ✅ done in v0.77.514.14（Sprint Phase 1；chat 8 + auth 8 + events 7 = 23 新 tests，全 82 passed） |
| TEST-109 | P1 | 🔴 | e2e 测试：注册 → 选角 → 对话 → 消费 candle | 测试 | 待办 |
| DOC-104 | P0 | 🔴 | 生产部署 runbook（`infra/deploy/PRODUCTION.md`） | 文档 | 待办 |
| BE-148 | P1 | 🔵 | 角色卡推荐版粘贴导入（SOP S4 产物 → preview/commit） | 后端 | ✅ done（2026-06-07）|
| AD-112 | P1 | 🔵 | 后台「导入角色包」弹窗 | 控制台 | ✅ done（2026-06-07）|
| BE-149 | P1 | 🟡 | 温度乐观异步/同步切换（`TEMPERATURE_OPTIMISTIC`） | 后端 | ✅ done（2026-06-17）|
| BE-150 | P2 | 🟡 | 遥测日志保留护栏（`pushBounded`/`LOG_RETENTION`，ADR-0010 前过渡） | 后端 | ✅ done（2026-06-17）|
| BE-151 | P2 | 🔵 | 成就发放后端（`achievementRepo.unlock` 当前无生产调用方，线上只读测试 seed；配 FE-119 成就闪屏） | 后端 | 待办（审计 2026-06-17 发现） |
| BE-152 | P1 | 🔵 | 高质量语音：服务器专用 ASR 输入录音签名能力 | 后端 | 已实现，服务器实测见 TEST-111/112 |
| BE-154 | P1 | 🔵 | 高质量 TTS 改 Fish s2.1-pro-free；后台四类默认 ID 手填，独立语音测试含搜索/试听 | 后端/后台 | ✅ 已实现；四类正式 ID 待填，服务器 ASR/签名仍见 TEST-111/112 |
| BE-153 | P1 | 🔵 | 高质量语音：独立会话、阿里 ASR、文字内核仅氛围、Gemini TTS 与失败恢复 | 后端 | ✅ 本地完成；服务器真实 ASR 见 TEST-112 |
| FE-123 | P1 | 🔵 | 高质量语音入口、按住录音、自动播放、恢复状态、角色音色绑定，无重播 | 前端/后台 | ✅ 本地验收完成（2026-10-01） |
| TEST-113 | P1 | 🔴 | 高质量语音本地回归及真实主模型/TTS 两轮验收 | 测试 | ✅ 完成；签名/真实 ASR 明确 SKIPPED，见 docs/voice-backend.md |
| TEST-111 | P0 | 🔴 | 服务器环境构建前：ASR 音频签名配置与权限测试 | 部署验收 | 待办；local 跳过不算通过 |
| TEST-112 | P0 | 🔴 | 服务器环境构建后：公网签名下载及阿里拉取闭环 | 部署验收 | 待办；local 跳过不算通过 |
| INFRA-109 | P1 | 🟡 | 控制台秘密入口防扫描（`ADMIN_PATH` + Caddy 装死） | 运维 | ✅ done（2026-06-11）|
| OPT-131 | P2 | 🟡 | 非支付接口共享契约收口 + `check-api-contracts` 改 apps/api 口径 | 重构 | ✅ done（2026-06-11）|
| DEFER-001 | — | — | 应用商店打包（Capacitor / Tauri） | 暂缓 | 不做 |
| DEFER-002 | — | — | ~~apps/server（Cloudflare Workers）补完~~ → 重定义为 **edge 层一等公民** | **已重定义** | ADR-0008 方案 A；后续工作落到 BE-131/134-138 + INFRA-104/107 |
| DEFER-003 | — | — | apps/admin React 版生产化 | 暂缓 | React 壳已落地，生产 API/安全仍 W5+ |

> "🔴 测试"当前指 TEST-103 是对话命脉的硬性缺失；TEST-101 已完成基础纯函数/schema 覆盖。

> **2026-05-10 复审口径**：当前可运营路线是 `apps/mock-server + Docker`，`apps/server` Cloudflare Workers 仍属 DEFER-002。旧 P0 中 BE-102/103/104、FE-110/111、AD-102 已在 mock 路线落地；新的立即阻塞项转为 FE-119、INFRA-103、TEST-103、FE-120、AD-107。
> **2026-05-11 风险口径**：`pnpm dev:server` 已变为“新后端入口 + mock-server fallback”的本地联动模式。它能帮测试从 `apps/server:8789` 入口跑完整链路，但不代表 Workers 真实业务实现完成；生产不得开启 `ENABLE_MOCK_FALLBACK`。

---

## §三　P0 详细（阻塞当前阶段定位 = 网页端可上服务器运营）

### TEST-111 / TEST-112 高质量语音签名上线检查（2026-10-01）

关联：BE-152。高质量语音沿用文字内核，仅保留氛围侧袋；**不做重播**。
本地功能与主模型/TTS 验收已完成（BE-153 / FE-123 / TEST-113）。`DEPLOY_MODE=local` 明确跳过签名和依赖公网 URL 的真实 ASR，不能伪造识别成功；本地可用显式文字测试后续链路。

**TEST-111：在服务器环境构建前完成**

- [ ] 确认 `DEPLOY_MODE=server`、`VOICE_ASR_PUBLIC_ORIGIN` 为真实公网 HTTPS 域名、独立签名密钥至少 32 字符，TTL 为 60–3600 秒（默认 900）。密钥从部署环境注入，不烘入镜像。
- [ ] 在隔离测试库执行 `apps/api/src/voice/asr-signing.test.ts`；验证本人输入录音才能签发，其他用户/输出音频不能签发，过期、参数篡改、文件替换、密钥轮换均失效。
- [ ] 检查 Caddy >= 2.8 的配置，签名路径不写完整访问日志；CDN 不缓存；签名 URL 的 query、GET/HEAD/Range 能完整转发。若走 Worker edge，确认内部 token 由代理注入，不能要求阿里提供用户登录 token。
- [ ] 若已有运行版本，执行 `node scripts/asr-signature-check.mjs pre-build`；首次部署无该路由时，此项标记“首次部署，构建后必测”，不可写成通过。

**TEST-112：在服务器环境构建后、开放功能前完成**

- [ ] 用自己的合成测试录音取得输入 assetId，设置 `YELAN_API_BASE`、`YELAN_USER_TOKEN`、`VOICE_ASR_TEST_ASSET_ID`，执行 `DEPLOY_MODE=server node scripts/asr-signature-check.mjs post-build`；保存脱敏结果。不得使用真实用户私密录音。
- [ ] 从服务器外部网络确认签名 GET/HEAD/Range 成功、文件校验一致；无签名/篡改/过期/错误资源均拒绝；普通音频接口仍需登录。等待到期再测拒绝，不能仅以“改过期字段”替代真实到期测试。
- [ ] 阿里 ASR 使用该短效 URL：提交一次 → 保存 task_id → 轮询原任务 → 下载并持久化非空转写；检查子任务成功，测量耗时，刷新/重试不得重复提交原任务。
- [ ] 验证容器重启、持久卷恢复后音频仍可读取；密钥稳定时有效链接可在 TTL 内继续下载，轮换密钥后旧链接立即失效。
- [ ] 确认本地检查报告是 `SKIPPED/LOCAL_SIGNATURE_SKIPPED`，不得充当上述服务器测试记录。服务器签名配置缺失应报 503，不能回退为跳过或永久公开音频。


### 2026-05-10 复审新增 P0

这些是当前真正会卡推进、或越晚越滚大的问题：

- **FE-119 prototype → apps/web 主体验移植**：`Conversation`、`CharacterSelect`、`OpeningScene`、`NarrativeCutoff`、Drawer、成就闪屏仍大量 `return null`。不先补 UI，SSE / 付费截断 / 成就事件都接到空气上。
- **INFRA-103 ESLint + Prettier + CI check**：根目录仍没有 eslint/prettier 配置，`apps/web` 写了 lint script 但依赖未配。代码量继续增长会迅速风格漂移。
- **TEST-103 核心对话流集成测试**：SSE 协议已用 Zod 校验，但还缺覆盖 `chunk/meta/achievement/cutoff/error/done` 到 `useChat` 和 store 的集成测试。
- **FE-120 useChat 消息状态改 ref/store**：`send` 仍依赖 `messages` 且自身修改 `messages`，UI 接入输入框后有闭包、重渲染和历史错乱风险。
- **AD-107 移除 Admin 默认 token fallback**：`apps/admin/src/api/client.ts` 仍 fallback 到 `admin-dev-token`。本地可接受，任何非本地访问前必须移除。

- **TEST-105 apps/server 联动 fallback 风险回归**：刚新增 `apps/server/src/routes/mock-fallback.ts` 与 `scripts/dev-server-linked.mjs`，属于服务边界高风险改动。

- **BE-131 apps/server admin 加 requireAdmin（灰测窗口必做）**：当前 `apps/server/src/routes/admin/index.ts:15` 注释着 `TODO: requireAdminAuth()` 但**没装任何鉴权中间件**；`middleware/auth.ts:11` 拿到 token 也只 `c.set('userId','TODO')` 不校验。当前不爆炸的唯一理由是 apps/server 没部署。一旦 ENABLE_MOCK_FALLBACK 配错或 Worker 误上线，admin 路径对全网裸奔。修法：`adminRoute.use('*', requireAdmin())` 一行 + 检查 `X-Admin-Token === env.ADMIN_TOKEN`。即使 S1 选 C 方案删 apps/server，这一行也不浪费。

**测试部明日重点**：

| 场景 | 需要验证 |
|---|---|
| 启动编排 | `pnpm dev:server` 在 8787 已占用 / 未占用两种情况下都能复用或启动 apps/api，并启动 `apps/server:8789` |
| 健康检查 | `GET 8789/health` 必须显示 `mockFallback.enabled=true`；`pnpm dev:server:raw` 不应显示开启 |
| Admin 静态资源 | `GET 8789/admin`、刷新、深 hash、`/admin-legacy`、JS/CSS assets 全部可加载 |
| Admin 写操作 | 经 `8789/api/admin/*` 创建/编辑角色卡、policy、sidecar prompt、IF 暗号，审计 reason 正常落盘 |
| SSE 对话 | 经 `8789/api/chat` 返回 `meta / atmosphere / chunk / structured / done`，中文不乱码，流不断、错误码不被吞 |
| 鉴权边界 | 未带 token / 错 token / 默认 token / 自定义 token 在 8789 与 8787 行为一致 |
| CORS / 同源 | web 指向 `8789`、后台同源 `8789`、直接 `8787` 三种访问都不互相污染 localStorage |
| 代理错误 | apps/api 停掉时，8789 应明确失败，不应假装成功 |
| 大请求/长响应 | 长 history、长 SSE、admin 导出 CSV 不被代理截断 |
| 生产防误开 | 检查部署脚本、`.env.example`、wrangler vars 不默认开启 `ENABLE_MOCK_FALLBACK` |

---

### BE-101 角色卡 DB 化 + CRUD

**上下文**：现在角色卡是 `packages/prompts/characters/*.yaml` 文件 → 启动时读。改一个字段要 git commit + 重启。要求 #8 明确"角色卡易于增减维护"。

**做什么**：

- 迁移 `0002_characters.sql`：表 `characters`（id / slug / name / rarity / priceCandle / openingFirstVisit / openingReturnVisit / boundaryDefault / forbiddenPhrases / description / styleTags / isActive / updatedAt）
- `apps/api/src/services/characters.ts`：list / get / upsert / disable
- `apps/api/src/routes/admin/characters.ts`：GET / POST / PATCH / DELETE
- 加载顺序：DB → fallback `packages/prompts` 文件
- 关联：AD-101

**验收**：在控制台 `#characters` 面板创建一个新角色 → 立即在 web 选角界面看到 → 对话能用。无需重启。

---

### BE-102 长期记忆上服务器

**状态**：✅ apps/api 当前运营路线已落地（v0.73.510.16）。PG 迁移 / 字段级加密归入 BE-107 / BE-115。

**上下文**：[ADR-0005](docs/tech/adr/0005-account-bound-state.md) 拍板。

**做什么**：

- 迁移 `0003_user_memories.sql`：
  - `user_preferences`（id / userId / characterId / mode / text / embedding BYTEA / weight / lastUsedAt）
  - `user_events`（id / userId / characterId / mode / date / text / embedding BYTEA / emotion）
- `apps/api/src/routes/me/memories.ts`：
  - `GET /api/me/memories?since=` 增量同步
  - `POST /api/me/memories` 批量 upsert
  - `DELETE /api/me/memories/:id` 软删（tombstone）
  - `POST /api/me/memories/recall` 服务端做 cosine top-K（备本地降级用）
- 关联：FE-110 / DOC-101

**验收**：用户 A 在浏览器 1 加偏好"不喜欢被叫宝贝" → 浏览器 2 登录同账号 → recall 命中。

---

### BE-103 UI 偏好上服务器

**状态**：✅ apps/api 当前运营路线已落地（v0.73.510.16）。

**上下文**：要求 #7 + ADR-0005 引申 — 暗色 / 字号 / stage 调参也要同步。

**做什么**：

- 迁移 `0004_user_preferences.sql`：表 `user_ui_preferences`（userId / theme / fontScale / locale / stageLayoutOverrides JSONB / updatedAt）
- `apps/api/src/routes/me/preferences.ts`：`GET /api/me/preferences` / `PUT /api/me/preferences`
- 关联：FE-111

**验收**：浏览器 1 切换到亮色 / 字号 +2 → 浏览器 2 登录同账号 → 偏好已应用。

---

### BE-104 用量规则中央化（policy 表）

**状态**：✅ apps/api 当前运营路线已落地（v0.73.510.16），`policyService` 已被配额、注册赠烛、问卷停留秒数等读取。

**上下文**：现在规则散落在 `packages/shared/src/constants.ts` 硬编码，运营改不动。要求 #13。

**做什么**：

- 迁移 `0005_policy.sql`：表 `policy_kv`（key / value / updatedBy / updatedAt）
- 初始 seed：`DAILY_FREE_ROUND_LIMIT=20` / `REGISTER_CANDLE_GRANT=100` / `SURVEY_MIN_DWELL_SECONDS=5` / `CONTEXT_COMPRESS_TOKEN_LIMIT=8000` / `KEY_SENTENCE_PAUSE_MS=700` / `IF_DAILY_REDEEM_LIMIT=3`（不设成本熔断阈值见修订 B）
- `apps/api/src/services/policy.ts`：`get<T>(key, fallback)` / `set(key, value, reason)`，启动加载 + 缓存
- `apps/api/src/routes/admin/policy.ts`：`GET /api/admin/policy` / `PATCH /api/admin/policy/:key`
- 业务方：`consumeOneRound` / cost-tracker / surveys 改读 policy 而非 constants
- 关联：AD-102

**验收**：`#policy` 面板把 `DAILY_FREE_ROUND_LIMIT` 改 30 → 任何用户 30 轮才被限。

---

### FE-110 Dexie ↔ 服务端双向同步

**状态**：✅ 已落地（v0.73.510.16）。当前策略为 dirty 保留重试；独立离线队列表可放入 P2 优化。

**上下文**：BE-102 落地后，本地 Dexie 改成缓存层。

**做什么**：

- 新建 `apps/web/src/memory/sync.ts`：
  - `syncUp()` 把本地 dirty 行 POST 上去
  - `syncDown(since)` 拉远端增量 merge 进 Dexie
  - 启动时跑一次；定时 30s + 关键事件触发（如发完一轮对话）
  - 离线队列（IndexedDB 单独 table）
- 改 `recall.ts`：先查本地，cache miss 则 POST `/api/me/memories/recall`
- 关联：BE-102

**验收**：拔网线写偏好 → 上线后自动 flush；多浏览器同账号 30s 内一致。

---

### FE-111 UI 偏好 store

**状态**：✅ 已落地（v0.73.510.16）。

**上下文**：BE-103 落地后，前端把现有局部状态改成 store + 服务端持久。

**做什么**：

- `apps/web/src/stores/preferencesStore.ts`：theme / fontScale / locale / 调参等
- 启动 `useEffect`：`GET /api/me/preferences` 注入 store
- 任何 `set*` 走 debounce 200ms `PUT /api/me/preferences`
- TweaksPanel 的"持久化"开关读这个 store
- 关联：BE-103

**验收**：刷新页面后偏好还在；切换设备登录后偏好同步。

---

### AD-101 `#characters` 角色卡管理面板

**上下文**：BE-101 的 UI 出口。

**做什么**：

- console.html 新 view `views.characters`：表格列出全部角色 + "新建" 按钮 + 行内"编辑/停用"
- 编辑弹窗：所有角色卡字段 + 双语 opening / forbidden 多选
- NAV "运营" 分组加入

**验收**：从面板创建新角色立即可对话；改 forbiddenPhrases 立即生效（chat 重新装配 prompt）。

---

### AD-102 `#policy` 用量规则面板

**状态**：✅ 已落地（v0.73.510.16）。

**上下文**：BE-104 的 UI 出口。

**做什么**：

- apps/admin `Policy` 面板：列出所有 policy_kv 行 + 行内可编辑 + 保存时填写 reason
- 分组渲染：配额 / 成本 / 内容策略 / 杂项
- 改值后 toast + 审计落 `state.adminAudit`

**验收**：改 `DAILY_FREE_ROUND_LIMIT` 立即对所有用户生效；操作进 `#audit`。

---

### DOC-101 数据分工表

**上下文**：要求 #12，ADR-0005 之后口径已变，需要可见的对照表。

**做什么**：

- 新建 `docs/architecture/data-locality.md`，二列表：
  - 列：本地（Dexie / IndexedDB / localStorage）vs 服务器（PG）
  - 行：每一类数据 + 谁是真理源 + 同步策略 + 删除路径
- 在 README、structure.md、apps/web/src/memory/README.md 都加链接
- 至少覆盖：messages / preferences / events / embeddings / sessions / candle / quota / characters / achievements / user flags / UI prefs / 设备 fingerprint

**验收**：新人 5 分钟看完就能回答"X 数据存在哪、谁权威、删怎么删"。

---

## §四　P1 详细

### BE-105 multi-agent 架构（已废弃）

**状态**：废弃。用户确认需求不是重型 Agent 平台，而是 5 个便宜、专职、prompt 可调的侧袋 AI。对应能力已拆到 BE-121~126 / AD-108。

**禁止回流**：当前阶段不要新增 `agent_config` 表，不要恢复 `#agents` 面板，不要把侧袋任务做成独立微服务。

---

### BE-106 用户画像聚合 / 仪表盘 API

**上下文**：要求 #9。

**做什么**：

- `apps/api/src/routes/admin/analytics.ts`：
  - `GET /api/admin/analytics/dau?days=30`
  - `GET /api/admin/analytics/retention` D1 / D7
  - `GET /api/admin/analytics/funnel`（注册→首次对话→付费）
  - `GET /api/admin/analytics/per-character`（各角色对话占比）
- `GET /api/admin/users/:id/profile` 单用户 360°（注册时间、最近会话、消费总额、烛账、解锁角色、IF 状态、最近 messages、画像 tags）
- 关联：AD-104 / AD-105

---

### AD-103 `#agents` 面板（已废弃）

**结论**：不做独立 `#agents` 配置面板。侧袋 AI 已由 AD-108 `#sidecar-prompts` 替代。

**原因**：当前需求是 5 个固定规则 AI 的前置 prompt 调试，不是通用 Agent 平台。恢复 `#agents` 会把产品复杂度带偏。

---

### AD-104 `#dashboard` 仪表盘

**上下文**：BE-106 出口。

**做什么**：DAU/WAU/MAU 折线 + 留存表 + 漏斗。SVG sparkline 即可，先求"有"。

---

### TEST-101 关键模块测试

**做什么**：

| 模块 | 理由 |
|---|---|
| `packages/shared/src/schemas/*` | zod schema 边界 |
| `apps/api/src/pipeline/sentence-segmenter.ts` | 纯函数，断句边界多 |
| `apps/api/src/pipeline/stage-engine.ts` | 状态转换 |
| `apps/api/src/pipeline/boundary.ts` | 合规判断 |

**验收**：`pnpm test` 跑过 ≥ 30 个 case。

---

## §五　P2 / P3 详细

### BE-107 apps/api → Postgres 切换层

**做什么**：

- `apps/api/src/store/postgres.ts`：实现与 `persistence.ts` 同接口的 PG 版
- 用 `STORE_BACKEND=json|pg` 切换
- docker-compose 加 postgres 服务
- 关联：BE-115（加密静态）

---

### BE-115 字段级加密静态（ADR）

**做什么**：起 ADR-0006，决定哪些字段（preferences.text / events.text）服务端静态加密；KMS / 主密钥 KEK 来源。

---

### BE-151 成就发放后端

**背景**（审计 2026-06-17 发现）：除 repo 与测试外，全仓**无任何代码写 `userAchievements`**，`achievementRepo.unlock` 零生产调用方。成就可读（`/api/achievements`、`/api/me`）但**线上从不授予**，只有测试 seed 的数据；成就闪屏 UI（FE-119）也仍 `return null` —— 前后端两半都未实装。

**做什么**：

- 定义触发规则：哪些事件解锁哪个成就（首充 / 连续登录 / 对话轮数 / IF 暗号解锁 / 烛火消费 …）
- 在对应业务路径调 `achievementRepo.unlock(userId, achievementId, sessionId?)`（已是幂等写口）
- 解锁后经 SSE `achievement` 事件推前端（协议已存在，见 `ChatStreamEventSchema`），配合 FE-119 闪屏
- 补集成测试：解锁幂等 + SSE 事件投递

**关联**：FE-119（成就闪屏 UI）、TEST-103（核心对话流集成测试）。换 PG 时随 `achievementRepo` 一并异步化。

---

### FE-114 / FE-115 / FE-116 / FE-117 / FE-118 前端结构优化

来自旧 `优化.md`：

- **FE-114**：shared 子目录加 barrel + 根 index 简化；删 `apps/web/src/types/index.ts` 死代码
- **FE-115**：`App.tsx` 场景 lazy 化 + `DrawerShell` PANEL_MAP 替代 switch-IIFE
- **FE-116**：`components/{achievement,particles,tweaks}` 全量 barrel
- **FE-117**：`DrawerId` 类型移到 `@yelan/shared`
- **FE-118**：CSS Modules 全量化 + `design-tokens` 构建期生成 CSS 变量

---

### AD-105 `#users` 详情页

**做什么**：在 users 表行点用户 → 详情页：基础信息 + 烛账 + 配额 + 会话 + 记忆 / 偏好（来自 BE-102/103）。

---

### AD-106 操作说明 tooltip

**做什么**：每个按钮加 `title` / hover 弹层 + "为什么这么做"链接到 docs/operations 对应 runbook。

---

### INFRA-101 备份脚本

**做什么**：`scripts/backup-state.sh` + cron 提示；PG 用 pg_dump。

---

### DOC-102 顶层架构图

**做什么**：mermaid + 一页：客户端 / apps/api / Caddy / LLM / DB / 数据流。

---

## §六　已完成（参考 — 历史变更见 structure.md）

- ✅ **ASR 输入录音短效签名基础能力**（2026-10-01，BE-152）— 仅 server 签发；local 返回显式跳过；HMAC 绑定资产与时效，GET/HEAD/Range 下载，部署变量与访问日志处理已接入。服务器构建前后实测仍待 TEST-111/112，不因本地隔离测试通过而勾选。

- ✅ **温度乐观异步/同步切换 + 日志护栏**（2026-06-17，BE-149/BE-150）— 后台「策略」加 `TEMPERATURE_OPTIMISTIC`（乐观异步=不阻塞首字、judge 异步供下一轮 / 同步阻塞=回复前 await、实时反应本轮）；`store/persistence.ts` 加 `pushBounded`/`LOG_RETENTION`（conversationLogs 5000 上限）给只追加遥测数组上界，财务/审计不自动修剪（ADR-0010 迁 PG 前过渡）。详见 `docs/changelog/structure.md` 0.8.7
- ✅ **角色卡推荐版粘贴导入**（2026-06-07，BE-148/AD-112）— shared `AdminCharacterImport*` schema + 归一化；`/api/admin/characters/import/preview`（不写库）+ `/import`（写库 + `character.import` 审计）；create/update/upsert 三模式，tier2 识别但不入库；后台角色卡面板「导入角色包」弹窗。详见 [`docs/audit/2026-06-07-character-import.md`](audit/2026-06-07-character-import.md)
- ✅ **控制台秘密入口防扫描**（2026-06-11，INFRA-109）— 运营后台从 `/admin` 藏到 `.env` 的 `{$ADMIN_PATH}`；Caddy 改写转发 + `/admin*` 装死成与「路径不存在」逐字节相同 landing；`apps/api` `/admin/*` 查无文件改 404 堵 SPA fallback 漏洞。降噪非鉴权，真正的门仍是 `ADMIN_TOKEN`。详见 [`docs/audit/2026-06-11-admin-console-secret-path.md`](audit/2026-06-11-admin-console-secret-path.md)
- ✅ **非支付接口共享契约收口**（2026-06-11，OPT-131）— 补齐 `achievements`/`logs`/`sessions`/admin LLM API/prompt 发布回滚/sidecar config/survey 共享契约；支付路由在契约检查中明确列为 deferred；`scripts/check-api-contracts.mjs` 从 mock-server 口径改为 apps/api 口径并区分 internal/deferred；旧 `console.html` 冻结为 DevOps fallback。详见 `docs/changelog/structure.md` 0.8.6
- ✅ **会员 mock 闭环**（2026-05-27，BE-147 / FE-123 / AD-111 / TEST-110）— 按手册推荐三档「月光 / 星河 / 永夜」落地周/月套餐；`/api/billing/{plans,subscription,subscribe}` 读会员服务并模拟激活；有效会员跳过免费轮次截断；订阅激活按套餐赠烛，流水 reason 为 `subscription_grant`；React 后台新增「会员」面板维护价格、折扣、赠送量、上下架，支持人工开通与到期不续；前端「续夜」抽屉接 mock 订阅 UI。真实支付验签仍留上线前 F2。审计见 [`docs/audit/2026-05-27-membership-mock-subscription.md`](audit/2026-05-27-membership-mock-subscription.md)
- ✅ **邮箱 + 密码鉴权**（2026-05-20，BE-143 / FE-122 / AD-110）— user-account Phase 1-6：`/api/auth/email/{register,login}` + `/password/{login,reset}`、`/api/me/{password,profile,email/bind,phone/change,sessions/revoke-all,delete}`；persistence `emailIndex` + `PersistedUser.{passwordHash,tokenVersion,deletedAt,email,nickname,avatarUrl,bio}`；软删注销后 OTP 不能复活（verify 410）；LoginScene 邮箱默认、YouPanel 账户区、换号统一清本机（`lib/clear-local-user-data.ts`）；Users 面板补 email/id 列。详见 [`docs/audit/user-account-2026-05-20.md`](audit/user-account-2026-05-20.md)
- ✅ **记忆门控 + 治理**（2026-05-21，BE-144/145、FE-112/113）— `FEATURE_MEMORY_THROTTLE` 门控（首轮 / stage 切换 / 关系类关键词 / 满 4 轮才注入「她记得」）；真·遗忘连画像 / 概要一起清并写审计；上下文滚动压缩按 `compressedUntilMessageId` 去重；画像改替换式快照 + 结构化 `userProfileFacts/Changelog`，`/api/me/memories` 回传 `profile`，MemoryPanel 展示。通道对比见 [`docs/sprint/2026-05-21-memory-channel-audit.md`](sprint/2026-05-21-memory-channel-audit.md)
- ✅ **`@yelan/llm` 抽包**（2026-05，OPT-130）— provider 工厂 / `LlmRouter` / pricing / think-sanitizer / stream-guard 从 apps/api·apps/server 上提为 workspace 包，两端只留 `create-router.ts`。见 `structure.md` v0.8.0 工程约定 #10
- ✅ **对话延迟优化**（2026-05-21）— 主 LLM 路由收紧 + 降延迟；诊断与修复见 `docs/audit/2026-05-21-chat-latency-diagnosis.md` / `-fix-report.md`
- ✅ **Sprint 2026-05-14 完成**（v0.77.514.14）— Phase 2 边缘层成型 9/9 + 灰测扫尾 3 件：BE-142（internal-token middleware /w INTERNAL_TOKEN_REQUIRED=false）、BE-135（mock-fallback token 注入 + HTTPS 守门）、INFRA-104（wrangler.toml + .env 配置）、BE-137（CORS 白名单）、BE-138（security headers）、BE-134（14 stub 删除、routes 22→8）、INFRA-107（Secrets SOP）、BE-136（rate-limit KV）、TEST-107（server 5 文件 24 tests 接入 verify:gray）；FE-120（useChat → zustand）、OPT-CHAT-CUTOFF-REQID（chat.ts requestId 注入）。全量 113 tests passed、contracts 0 errors。详见 [`docs/sprint/2026-05-14-report.md`](sprint/2026-05-14-report.md)
- ✅ **ADR-0009 INTERNAL_TOKEN 设计**（2026-05-14）— 4 决策点拍板：纯文本共享密钥 / Worker Secrets + Node .env / X-Internal-Token header / 手动轮转不设期；UNLIM_INTERNAL_TOKEN 不在此次范围（Phase 3 议）。详见 [`docs/tech/adr/0009-internal-token-design.md`](tech/adr/0009-internal-token-design.md)
- ✅ **Sprint Phase 1 完成**（v0.77.514.14）— BE-131 + BE-132 + BE-133 + TEST-108。apps/server admin 加 `requireAdmin`（middleware/admin-auth.ts）；chat 真消费 chunk.usage 走 input/output 分别计价（pricing.ts，6 provider 公开定价）；exchange-toggle policy_kv 闭环（characters 路由读 EXCHANGE_ENABLED → 403）；新增 chat/auth/events 路由单测共 23 项，全仓 82 tests passed。验收通过 2 轮，详见 [`docs/sprint/2026-05-14-gray-window.md`](sprint/2026-05-14-gray-window.md)
- ✅ **灰测卫生包**（v0.77.514.14）— BE-130 + TEST-106 + DOC-103 + INFRA-103 部分。`pnpm verify:gray` 全绿门禁（lint + typecheck + 20 tests + contracts 0 errors + 模式纪律 0 命中）；17 处 `Schema.parse` → zValidator 改造；token-guard 单 session + 全局日双闸 + deny 写 error.log；全局 requestId 中间件 + SSE 全 event 携带；FEATURE_REAL_LLM flag；OpeningScene/CharacterSelect/NarrativeCutoff 可点 + 8 个 drawer panel 占位；SurveyPanel 真上报 `/api/events`；gray-snapshot/reset 脚本；`docs/gray-test-checklist.md`。详见 [`接口审计与TODO.md §四`](../接口审计与TODO.md)


- ✅ Mock-server 完整后台（v0.6.0）
- ✅ 14 面板可视化控制台 console.html（v0.6.1）
- ✅ 一键流程：`pnpm setup/doctor/seed` + dev wrappers（v0.6.2）
- ✅ 一键切换部署模式 local/server + Dockerfile + Caddyfile（v0.6.3）
- ✅ ADR-0005 全量上行决策（v0.6.4）
- ✅ Mock-server 路由 1:1 with apps/server（v0.6.0，原 优化.md P0-1）
- ✅ DOC-101 数据分工表 `docs/architecture/data-locality.md`（v0.6.5）
- ✅ BE-101 角色卡 DB 化 + CRUD（v0.6.6）— mock-server `services/characters.ts` + `admin/characters` 路由；迁移 `0002_characters.sql`；首次启动 yaml seed；运营改字段下一轮对话立即生效
- ✅ AD-101 `#characters` 角色卡管理面板（v0.6.7）— console.html 列表 + 表单（新建/编辑）+ 停用/启用 + 从 yaml 重置；BE-101 验收链闭环（控制台改字段 → web 选角立即看到 → 对话 prompt 实时套用）
- ✅ BE-102/FE-110 长期记忆同步（v0.73.510.16）— mock-server `/api/me/memories` 增量拉取 / 批量 upsert / 删除 / recall；web `memory/sync.ts` 走 `api/memories.ts` 与 shared contracts
- ✅ BE-103/FE-111 UI 偏好同步（v0.73.510.16）— mock-server `/api/me/preferences` + web `preferencesStore` 启动拉取、debounce PUT；调用收敛到 `api/preferences.ts`
- ✅ BE-104/AD-102 用量规则中央化（v0.73.510.16）— mock-server `policyService` + `/api/admin/policy` + admin `Policy` 面板；`DAILY_FREE_ROUND_LIMIT` / `REGISTER_CANDLE_GRANT` 等从 policy 读取
- ✅ TEST-101 关键模块测试（v0.73.510.16）— `pnpm test` 覆盖 shared chat schema 与 mock-server pipeline / policy / memories 等关键模块
- ✅ SSE 协议硬化（v0.73.510.16）— web `api/sse.ts` 使用 `ChatStreamEventSchema` 校验，`useChat` 处理 `achievement` / `cutoff` / `error`
- ✅ 侧袋 AI 全量落地（v0.74.510.19）— BE-121~126 + FE-121 + AD-108，详见 `D:\ClaudeCode\修改报告.md`。5 个侧袋 AI（氛围判断/结构拆句/偏好记录/额度结束/上下文压缩），集成进 chat.ts 主对话链路，后台 panel 管理 prompt，前端 SSE 事件处理；删除 circuit-breaker.ts；温度/画像/概要落 state。**2026-05-20 修订**：原"IF 命中=温度 5"硬锁已废除，IF 命中改为温度 AI 的上下文信号而非下限（FEATURE_TEMP_V2）。
- ✅ 侧袋任务级渠道 + 温度 V2（v0.79.517.x）— `preferenceRecorder`/`quotaEnding`/`contextCompressor` 三类后台任务可独立绑定 API；后台 ServiceConfig 增加"侧袋任务渠道"区域；4 处 IF 温度硬锁（chat-pipeline、atmosphere-judge、if-unlock）全部清除；新 `FEATURE_TEMP_V2` flag 控制温度 prompt 与上下文增强字段，flag off 也不复活硬锁；新增 `PersistedUser.conversationRounds` 缓存计数，admin 用户列表新增"对话轮数"列
- ✅ TEST-104 侧袋 AI 回归测试（v0.74.510.19）— 新增 `sidecar-ai/state.test.ts` + `routes/admin/health.test.ts`，`pnpm --filter "./apps/mock-server" run test` 当前 9 文件 / 35 case 通过
- ✅ AD-109 React 后台角色卡字段补齐（v0.74.510.19）— `apps/admin/src/routes/Characters.tsx` 新增 `styleTags` / `forbiddenPhrases` 编辑，保存走既有 admin characters schema；已重新 build `apps/admin/dist`
- ✅ 本地新后端联动入口（v0.74.510.19）— `apps/server/src/routes/mock-fallback.ts` + `scripts/dev-server-linked.mjs`，`pnpm dev:server` 启动/复用 mock-server:8787 并启动 apps/server:8789；详见 ADR-0007。仅本地/测试，生产禁用

---

## §七　暂缓（明确不做）

| ID | 项目 | 何时做 | 备注 |
|---|---|---|---|
| DEFER-001 | 应用商店打包 | 现阶段不做 | 用户明确：先以网页端为主，打包另议 |
| DEFER-002 | `apps/server` 完整化（Cloudflare Workers） | Phase 1 W5+ | 当前仅新增本地 fallback 联动，不等于 Workers 业务实现完成 |
| DEFER-003 | `apps/admin/` React 版生产化 | Phase 1 W5+ | React 壳已落地；生产 API、安全、全量面板仍未完成 |

---

## §八　已拍板决策

### 决策 1（已定）：长期记忆 + UI 偏好 → 服务器

[ADR-0005](tech/adr/0005-account-bound-state.md)。覆盖旧"记忆零服务端"。

### 决策 2（已定）：路线 1（apps/api + Docker）

`infra/deploy/` 已落地 Docker + Caddy。

### 决策 3（已定）：新后端联动模式只用于本地/测试

[ADR-0007](tech/adr/0007-linked-server-mock-fallback.md)。`pnpm dev:server` 可从 `apps/server:8789` 入口代理到 `apps/api:8787`。**注**：ADR-0008 将 fallback 升级为生产配置，但仍要求 HTTPS + 内部 token 守门。

### 决策 4（已定，2026-05-14）：上线形态 = Worker edge + Node 主后端

[ADR-0008](tech/adr/0008-deployment-shape-decision.md) **方案 A**：
- `apps/server`（Cloudflare Worker）= edge 层：静态资源 / 鉴权 / rate-limit / CORS / security headers / `/api/*` 代理到 Node 后端
- `apps/mock-server` 改名 `apps/api`，容器化部署成 Node 主后端，承载全部业务逻辑 + Postgres 持久化
- 决策直接锁定的 TODO：BE-131/134-142、INFRA-104-108、TEST-107-109、DOC-104

### 决策 5（已定，2026-05-14）：INTERNAL_TOKEN 设计

[ADR-0009](tech/adr/0009-internal-token-design.md) — 边缘 ↔ Node 后端互验：
- 格式：纯文本共享密钥（32 字节 hex）
- 存储：Worker Secrets + Node `.env`（两端独立配置同值）
- 携带：`X-Internal-Token` HTTP header
- 轮转：不设有效期，手动轮转；通道分开（INTERNAL_TOKEN ≠ UNLIM_INTERNAL_TOKEN）
- Phase 2 工单：[`docs/sprint/2026-05-14-edge-layer.md`](sprint/2026-05-14-edge-layer.md)

---

## §九　维护规则

1. **加新任务**：选合适前缀 + 下一个序号；填进 §二 矩阵 + 加详细段
2. **完成一项**：把"待办"改"已完成 → done in v.X / commit-hash"，搬到 §六
3. **优先级变更**：在矩阵改 + 在详细段标注原因
4. **依赖关系**：用 "关联：X-NNN" 标注；P0 不能依赖 P1+
5. **决策**：影响多个任务的 → 起 ADR；本文记录摘要 + ADR 链接
6. PR 必须更新本文（如果动了任务范围）+ bump `structure.md` 版本号
