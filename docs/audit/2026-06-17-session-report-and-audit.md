# 任务报告与审计清单 — 2026-06-17

> 供开发部审计。本文件覆盖本会话全部产出,所有论断均可用文末「复核命令」独立验证。

---

## 〇　执行摘要

| 项 | 值 |
|---|---|
| 分支 | `codex/preference-consolidation`（**未推远端**） |
| 区间 | `3218c51`（会话起点）→ `71a58b2`（HEAD） |
| 提交数 | **10** |
| 变更规模 | 81 文件，+2282 / −509，新增 18 文件 |
| 工作区 | **干净**（无未提交改动） |
| 总门禁 | `pnpm verify:gray` **exit=0**（lint + typecheck + test:gray + contracts 全绿） |
| 测试 | apps/api **327** / shared **27** / server **24** 全过；contracts **0 error / 0 warning** |

工作分两阶段:
- **阶段一（C1–C5）**：把积压两周、横跨 0.8.3–0.8.7 的存量改动审计后分 5 个主题提交。
- **阶段二（缝 1–5）**：启动 ADR-0010 持久化重构的前置「仓储缝（Phase A）」，落地设计文档 + 5 个 repo 切片。

---

## 一　提交清单（逐条可核对）

| # | hash | 类型 | 文件 | +/− | 验证 |
|---|---|---|---|---|---|
| C1 | `6e5e114` | infra(deploy) | 13 | +443/−39 | typecheck+test+contracts |
| C2 | `20703f4` | feat(admin) | 7 | +830/−5 | typecheck+test |
| C3 | `66dd795` | feat(chat) | 6 | +110/−43 | typecheck+test |
| C4 | `c9bfc08` | refactor(contracts) | 42 | +481/−302 | verify:gray 全绿 |
| C5 | `be3ac0c` | fix(server) | 2 | +3/−5 | server lint 0 error |
| 缝1 | `38ea0d7` | refactor(store) | 5 | +167/−19 | verify:gray 全绿 |
| 缝2 | `63547a3` | refactor(store) | 4 | +80/−27 | typecheck+327 |
| 缝3 | `c180d9c` | refactor(store) | 4 | +32/−6 | typecheck+327 |
| 缝4 | `140793e` | refactor(store) | 3 | +48/−33 | typecheck+327 |
| 缝5 | `71a58b2` | refactor(store) | 4 | +101/−43 | typecheck+327 |

---

## 二　阶段一详情（存量收口 C1–C5）

### C1 `6e5e114` infra(deploy)：部署防呆 + 控制台秘密入口防扫描
- **范围**：`infra/deploy/{Caddyfile,docker-compose.yml,.env.example,Dockerfile,README.md}` + 新 `check.sh`、`apps/api/src/index.ts`、`config/deploy-mode.ts`、`services/llm-api-inventory.ts(+test)`、`apps/admin/src/routes/ServiceConfig.tsx`、`.gitignore`、审计 md。
- **审计要点**：
  - [ ] 运营后台从 `/admin` 迁到 `.env` 的 `{$ADMIN_PATH}`；`/admin*` 装死成与「路径不存在」逐字节相同 landing。
  - [ ] `apps/api/src/index.ts`：`/admin/*` 查无文件返回 **404**（不再回退 `index.html`），堵 SPA fallback 拿控制台 HTML。
  - [ ] `INTERNAL_TOKEN_REQUIRED=false` 为 Caddy 直连默认；NVIDIA 作 `env-main` 播种。
  - [ ] **明示**：此为降噪非鉴权，真正的门仍是 `ADMIN_TOKEN`（见审计 md「后续」）。

### C2 `20703f4` feat(admin)：角色卡推荐版粘贴导入
- **范围**：`CharacterImportDialog.tsx`、`Characters.tsx`、`admin/characters.ts`、`character-import.test.ts`、`contracts/admin.ts(+test)`、审计 md。
- **审计要点**：
  - [ ] `/import/preview` **不写库**；`/import` 写库并落 `character.import` 审计。
  - [ ] create/update/upsert 三模式；tier2 识别但**不入库**（避免污染主角色 prompt）。
  - [ ] **注意**：本提交一并落地 `contracts/admin` 全量 admin schema（LLM API / prompt / sidecar），其路由消费在 C4。整文件归组的结果，已在 commit message 注明。

### C3 `66dd795` feat(chat)：温度乐观异步/同步切换 `TEMPERATURE_OPTIMISTIC`
- **范围**：`chat-pipeline.ts(+test)`、`policy.ts`、`policy-definitions.ts`、`chat.ts`、`atmosphere-judge.ts`。
- **审计要点**：
  - [ ] 默认 `true`（乐观异步=不阻塞首字、judge 异步供下一轮）；`false`=同步阻塞、实时反应本轮。
  - [ ] **暗号瞬时升温在两种模式下都同步作用本轮、不留地板**（行为不变）。
  - [ ] `policy.ts` 启动 seed 改为「补齐任何缺失定义键」（新键在旧 state.json 上也立即出现在面板）—— 需确认不会覆盖已有值。

### C4 `c9bfc08` refactor(contracts)：非支付契约 + apps/api 收口 + 日志护栏
- **范围**：42 文件。`contracts/{achievements,logs,sessions,survey,index}`、各路由 zValidator、`persistence.ts` 日志护栏、mock-server→apps/api 改名、docs/structure+changelog、版本 bump→0.8.7、TODOlist 登记。
- **审计要点**：
  - [ ] contracts 检查 **0 error**，支付路由明确列 `deferred`。
  - [ ] `LOG_RETENTION.conversationLogs=5000`；**财务（candleLedger/payments）与审计（adminAudit）不自动修剪**。
  - [ ] 版本三处一致：`package.json` / `README` / `structure.md` 均 **0.8.7**。
  - [ ] TODOlist 新登记：BE-148/149/150、AD-112、INFRA-109、OPT-131。
  - [ ] `0005_policy.sql` 改动仅注释（无 schema 变更）。

### C5 `be3ac0c` fix(server)：清存量 lint error
- **范围**：`apps/server/src/{pipeline/moderation,services/billing}.ts`。
- **审计要点**：
  - [ ] 3 个 `no-unused-vars` error 清零（删未用 import/赋值、参数前缀 `_`）；**纯 lint 修复，无逻辑变更**。
  - [ ] 这 3 个 error 是**存量**（本会话之前已存在于已提交代码），非本批引入。

---

## 三　阶段二详情（持久化仓储缝 Phase A）

### 背景
ADR-0010 已拍板「生产换 Postgres」，但 `store.state()` 被调用 **353 次**（同步读 + 就地改内存对象 + `store.save()`），PG 的异步 I/O 无法原地替换。Phase A = **不改存储**，先把访问收口到异步签名的 repo，为换后端提供单一支点。设计见 [`docs/sprint/phase-a-repository-seam.md`](../sprint/phase-a-repository-seam.md)。

### 缝约定（每个 repo 必须满足 —— 审计基线）
- [ ] 方法签名一律 `async`（即便 JSON 实现同步）。
- [ ] 落盘由 repo 负责，调用方无 `store.save()`。
- [ ] 调用方不直接访问该集合的 `store.state().X`。
- [ ] **行为零变化**：id 前缀、字段、保留上限、审计落点逐字节一致。

### 已落地 5 个 repo（均 `apps/api/src/store/repositories/`）

| repo | 收口的裸泄漏 | 关键不变式（审计点） |
|---|---|---|
| `conversationLogRepo` | logs.ts、events.ts | `log_`/`tlm_` 前缀保留；retention 5000 不变 |
| `adminAuditRepo` | _audit.ts、audit.ts | `audit()` 仍同步 fire-and-forget（append 体内无 await → push 同步执行，`at(-1)` 断言不受影响）；query clamp（limit 1..1000、offset≥0）逐字节保留 |
| `achievementRepo` | achievements.ts、me.ts | 只读收口；`unlock` 为预留写口（当前无 production 写入方） |
| `uiPreferenceRepo` | me/preferences.ts | GET 返回缺省**不落库**；PUT 缺字段沿用上条；该集合收口后无裸泄漏 |
| `surveyRepo` | surveys.ts、admin/surveys.ts | 定义 CRUD + 提交；**admin 端 `users.name` 富集仍直接读 users（hub 残留，已注释标注）** |

### 关键审计论断:为何「零行为变化」成立
- [ ] **同步语义保持**：`audit()`、`ensureChatSession` 等门面虽调异步 repo，但 repo 写方法体内**无 `await`**，async 函数会同步执行到 push/save 再返回 Promise，故 `void repo.x()` 的副作用是同步的——所有「写后立即断言」的测试不受影响。
- [ ] **测试零改动通过**：5 个切片均未改任何测试，apps/api 327 测试全程绿（含直接 seed `store.state()` 的测试，证明 repo 与底层同一份内存状态）。
- [ ] **契约零变化**：路由的 zValidator/response schema 未动，contracts 检查 0 error 不变。

---

## 四　审计清单（开发部逐项核验）

### A. 编译 / 测试 / 门禁
- [ ] `pnpm verify:gray` → exit 0（已验：exit=0）。
- [ ] `pnpm -r run typecheck` → 10 项目全过。
- [ ] `pnpm --filter @yelan/api run test` → 327 passed。
- [ ] `pnpm --filter @yelan/shared run test` → 27 passed。
- [ ] `pnpm --filter @yelan/server run test` → 24 passed。
- [ ] `node scripts/check-api-contracts.mjs` → 0 error / 0 warning。

### B. 提交卫生
- [ ] `git status` 干净；HEAD=`71a58b2`，分支 `codex/preference-consolidation`。
- [ ] 10 个提交主题单一、message 与改动一致（逐条见 §一/§二/§三）。
- [ ] 无意外文件（如 `.local/state.json`、密钥、`_deploy_artifacts/`）被提交。

### C. 行为等价性（重构类，重点）
- [ ] C5 与缝 1–5 均为重构/修复，**无产品行为变更**；用 §三「零行为变化论断」核对。
- [ ] 抽查 `audit()` 调用点：写后立即读 `adminAudit.at(-1)` 的测试仍通过（`character-import.test.ts`、`memories.test.ts`、`sidecar-prompts.test.ts`）。
- [ ] 抽查 `/api/me/preferences` GET 未落库（无记录时返回缺省但不写盘）。

### D. 已知残留 / 技术债（**必须知悉**，详见 §五）
- [ ] `apps/server` 整层为 stub（含「永远放行/假成功」），靠不部署兜底。
- [ ] 支付全 mock，不能真实收款。
- [ ] web 端向量召回（embedder.worker）为空壳。
- [ ] `persistence.ts:50` 注释过时（passwordHash 实际已写）。
- [ ] 缺 `.gitattributes`（`core.autocrlf=true` → 提交 LF/CRLF 噪音）。

### E. 文档同步
- [ ] `docs/structure.md` + `docs/changelog/structure.md` 已到 0.8.7。
- [ ] `docs/TODOlist.md` 已登记 BE-148/149/150、AD-112、INFRA-109、OPT-131。
- [ ] 新增审计/设计文档：本文件、`2026-06-07-character-import.md`、`2026-06-11-admin-console-secret-path.md`、`sprint/phase-a-repository-seam.md`。

---

## 五　已知残留与后续（诚实披露，非本会话引入）

### 仓储缝剩余工作（Phase A 未完）
- **低风险待做**：`configRepo`（`admin/prompts` 5、`admin/costs` 3、`admin/config` 2、`admin/sidecar-prompts` 2 → policies/prompts.versions/costsDaily/sidecarPrompts/freeLimitOverride）；`admin/diagnostics`、`admin/seed`、`admin/health` 为聚合/运维只读，留最后。
- **高风险待做（缠对话热路径或 hub，需最细心）**：
  - session/message：`routes/sessions`(4)、`admin/sessions`(2)、`chat.ts`(3)、`chat-pipeline.ts`(8)。
  - if-code：`admin/if-codes`(4) 经 `if-unlock.ts` 缠暗号热路径。
  - **userRepo hub**：`quota`/`candle`/`events`(tokenIndex)/`admin/surveys`(users 富集)/`pay/_helpers` —— 财务/额度/鉴权域。
- `services/*`（users/memories/characters/membership/policy/llm-inventory）的 `store.state()` 都在 service 内部，业务层无泄漏，留到换 PG 那刻统一异步化。

### 项目级「坑」（本会话识别,大多在 TODOlist 有账）
| 档 | 坑 | 状态 |
|---|---|---|
| 🔴 | 持久化单文件 state.json 全量重写（BE-140/141） | Phase A 进行中（本会话起） |
| 🔴 | 支付全 mock，不能真收款（F2） | TODO 待办 |
| 🔴 | web 端向量召回空壳（embedder.worker） | 未登记，建议补 ID |
| 🟡 | apps/server 整层 stub（DEFER-002） | 靠不部署兜底 |
| 🟠 | `persistence.ts:50` 过时注释 / 缺 `.gitattributes` | 几分钟小修，未做 |
| 🟠 | DOC-104 生产部署 runbook | P0 待办 |

---

## 六　复核命令（开发部可直接跑）

```bash
# 1. 看本会话全部提交
git log --oneline --stat 3218c51..71a58b2

# 2. 全量门禁（应 exit 0）
pnpm verify:gray

# 3. 分包测试
pnpm --filter @yelan/api run test       # 327
pnpm --filter @yelan/shared run test    # 27
pnpm --filter @yelan/server run test    # 24

# 4. 契约（0 error）
node scripts/check-api-contracts.mjs

# 5. 仓储缝收口现状(看路由层还剩哪些裸泄漏)
git grep -c "store.state()" -- 'apps/api/src/routes/**/*.ts'

# 6. 工作区应干净
git status --short
```

---

## 七　独立复核与后续修复（2026-06-17 二次过审）

> 由独立审计方对本报告逐条复核后追加。复核结论：**报告高度可信**——门禁、计数、行为等价性、部署安全设计、诚实披露的残留项，核对项全部成立。下列为复核中**新发现 / 已落地修复**的项。

### 复核独立复现的门禁（与 §四 A 一致）
- `lint` 0 error、`typecheck` 10 项目全过、api **327** / shared **27** / server **24**、contracts **0 error / 0 warning** —— 均独立复现绿。

### 复核新发现并已修复
| # | 级别 | 发现 | 修复 |
|---|---|---|---|
| F1 | 🟠 中 | `services/memories.ts:380`（`forget_all`）**直接** `s.adminAudit.push(...)` 并手搓 `aud_` id，绕过 `adminAuditRepo`——§三 把 adminAudit 写入源列为「`_audit.ts`、`audit.ts`」时漏列了这处存量裸写，缝 2 名义完成实则带洞（换 PG 会漏改）。注意它不能简单改走 `audit()` 门面：门面不透传 `actor`，会把 `actor:'user'` 落成 `'admin'`。 | 改走 `adminAuditRepo.append({ actor:'user', ... })`，id/ts 由 repo 生成（与原逐字节一致）；`memories.test.ts` 的 `adminAudit.at(-1)` + `actor:'user'` 断言仍绿。 |
| F5 | 🟠 中 | `services/memories.ts:454` 模板串里嵌了一个**裸 NUL 字节(0x00)**（应为 ` `，与同文件 199/235 行的写法不一致），导致全文件被工具判定为 binary、且易被编辑器/格式化器静默吞掉。 | 裸 NUL → ` `（运行期同为 U+0000、键值逐字节一致；该 key 仅为瞬时去重 Map 键，不落盘）。 |
| F2 | 🟡 低 | §〇/§四B 称「工作区干净」，但 `git status` 实有一条未跟踪：本报告自身。 | 提交本报告（含此复核段），工作区归零。 |
| F3 | ℹ️ | 成就功能**生产侧无发放路径**：除 repo 与测试外无任何代码写 `userAchievements`（`achievementRepo.unlock` 零调用）。§三「预留写口」准确但淡化了「整条授予链路未实装」。 | 登记 **BE-151**（配 FE-119 成就闪屏）。 |
| F4 | ▫️ | `Caddyfile` 注释称资源放行块「必须排在 /admin* 之前」；Caddy `handle` 按 matcher 特异性自动排序，源码顺序不承重。 | 更正注释。 |
| — | 🟠 | `persistence.ts:50` 过时注释（passwordHash 实已写）；缺 `.gitattributes`。 | 更新注释；新增 `.gitattributes`（`* text=auto eol=lf`）。 |

> adminAudit 缝经 F1 修复后，路由/业务层已**无**对 `adminAudit` 的裸写（仅 `health`/`seed` 等运维只读保留）。
