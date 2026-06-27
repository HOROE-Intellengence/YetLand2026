# 数据分工表（本地 vs 服务器）

> **Last updated**: 2026-05-18
> **Owner**: 工程 Lead
> **决策依据**: [ADR-0005 账号绑定的全量状态同步](../tech/adr/0005-account-bound-state.md)
> **维护要求**: 任何数据存储位置 / 真理源 / 同步策略的改动 = 同一 PR 内必须更新本文档

---

## §一　总口径（一句话）

> **服务器是数据真理源，本地仅做缓存与即时态。**
>
> 用户身份 / 长期记忆 / UI 偏好 / 烛账 / 配额 / 会话 / 角色解锁 — 全部账号绑定，登录即恢复。
> 浏览器 Dexie / localStorage / Zustand 只承担四件事：①离线缓存让 recall 链路不被网络抖动卡住；②嵌入向量在浏览器算（隐私+成本）；③即时 UI 态（场景、抽屉开合、成就闪屏）；④当前设备按角色续聊快照（只为沉浸连续性，不是真理源）。

ADR-0005 之前隐含的"记忆零服务端"原则**已废止**。如果代码 / 注释 / 文档里仍有该说法，按本文修。

`pnpm dev:server` 的联动 fallback 不改变任何数据真相源：`apps/server:8789` 只是入口代理，运行期数据仍来自 `apps/api/.local/state.json`。不要把联动模式测试结果误记为 Postgres / Redis / KV 已验证。

---

## §二　主表

> 列含义：
> - **真理源**：以哪边为准；冲突时另一边失败回退。
> - **本地副本**：浏览器是否存、存在哪。`—` 表示不存。
> - **服务端表 / 路由**：PG 表名 + 主要 API 路径。`(待)` 表示尚未迁移落地，会标 TODO ID。
> - **同步策略**：写入路径 + 读取路径 + 失败兜底。
> - **删除路径**：用户/运营要"删干净"时怎么走。

### 1. 身份 / 账号

| 数据 | 真理源 | 本地副本 | 服务端表 / 路由 | 同步策略 | 删除路径 |
|---|---|---|---|---|---|
| 用户记录 | **PG** | — | `users` / `/api/auth/{otp,verify,me}` | OTP 登录后 `me` 拉取，前端不持久化用户对象 | 运营在 `#users` 软删（待 AD-105） |
| Auth token | **客户端** | `localStorage["yelan-token"]` | `users.token`（apps/api `tokenIndex`） | 登录写本地+服务端；登出双清 | 登出 / 切账号即删 |
| 用户标记（`if_unlocked` / `narrative_boundary` 等） | **PG** | — | `users` / `user_flags` | 走 `/api/me` 取 | 同上 |
| 设备 fingerprint | **未实现** | — | — | 留给访客模式 + 安全审计；落地前先 ADR | n/a |

### 2. 长期记忆（ADR-0005 核心）

| 数据 | 真理源 | 本地副本 | 服务端表 / 路由 | 同步策略 | 删除路径 |
|---|---|---|---|---|---|
| 偏好 `preferences` | **服务端**（mock 期 `state.userPreferences`；PG 迁移随 BE-107/BE-115） | Dexie `yelan-memory.preferences` | `user_preferences` / `/api/me/memories` | 启动 `syncDown(since)` → recall 本地优先, miss 走 `/recall`；写入本地立即 + 异步 POST，失败保留 dirty 重试；冲突 last-write-wins by `updatedAt` | "忘了一切" 按钮 → 服务端真删 + 本地清 + 审计落 `adminAudit` |
| 事件 `events` | **PG**（同上） | Dexie `yelan-memory.events` | `user_events` / 同上 | 同上 | 同上 |
| 嵌入向量 `embedding` | **PG (BYTEA)**（同上） | Dexie 行内 `Float32Array` | 同上 | 浏览器算（bge-small-zh-v1.5），上传时序列化为 bytes；服务端只存不算 | 随对应记忆行删 |

> **本地 Dexie 不再是真理源**，只是缓存。详见 [`apps/web/src/memory/README.md`](../../apps/web/src/memory/README.md)。

### 3. UI 偏好

| 数据 | 真理源 | 本地副本 | 服务端表 / 路由 | 同步策略 | 删除路径 |
|---|---|---|---|---|---|
| 主题 / 字号 / 语言 / stage 布局调参 | **服务端**（mock 期 `state.userUIPreferences`；PG 迁移随 BE-107） | Zustand `preferencesStore` + 内存镜像 | `user_ui_preferences` / `/api/me/preferences` | 启动 `GET` 注入 store；任何 `set*` debounce 200ms `PUT` | 服务端真删 + 前端 reset 为默认 |
| `apiBase` | **客户端** | `localStorage["yelan-api-base"]` | — | 仅本机有效，部署模式切换用 | 清浏览器存储 |
| 即时 UI 态（场景 / 抽屉开合 / 成就闪屏 / 当前 stage） | **客户端** | Zustand 内存（`sessionStore` / `drawerStore`） | — | 不持久；刷新即丢；下一次 `me` + recall 重建 | n/a |
| 调参面板 `tweaks` | **待并入 UI 偏好** | 当前仅 useState（注释里说要落 localStorage 但未实现） | 同 UI 偏好 | FE-111 接通后走服务端 | 同 UI 偏好 |

### 4. 对话与消息

| 数据 | 真理源 | 本地副本 | 服务端表 / 路由 | 同步策略 | 删除路径 |
|---|---|---|---|---|---|
| 会话 `sessions` | **PG**（mock 期 `state.sessions`） | `localStorage["yelan.chatSession.<characterId>"]` 保存当前设备 `sessionId` 快照 | `conversation_sessions` / `/api/sessions{,/recent,/:id/messages}` | `/api/chat` 收到未知 `sessionId` 自动 upsert；显式创建仍走 `/api/sessions`；本地快照仅用于同设备续聊 | 运营 `#sessions` 删；"清除本机对话"只删 localStorage 并换新 `sessionId` |
| 消息 `messages` | **PG**（mock 期 `state.messages`） | 同上，保存当前角色当前设备消息快照 | `conversation_logs` / 同上 | 前端发送时带本地 history 辅助上下文；服务端每轮写 `state.messages[sessionId]`；后台"会话"从服务端读 | 运营同上；本机清除不删服务器日志 |
| 当前会话 `stage` / `boundary` / `temperature` / `round` | 服务端派生 / 返回为准 | 同上，保存当前设备 UI 连续性 | `users` / `user_flags` / `temperatureLogs` / `/api/chat` | stage-engine + boundary + 氛围判断在服务端每轮重算；前端快照只恢复刷新后的观感 | 本机清除重置本地 stage/boundary/temp/round；不清服务器 IF 解锁、用户标记或温度日志 |

### 5. 烛账 / 配额 / 商业

| 数据 | 真理源 | 本地副本 | 服务端表 / 路由 | 同步策略 | 删除路径 |
|---|---|---|---|---|---|
| 烛账余额 | **PG** | Zustand `candleStore.balance`（仅展示） | `candle_balance` + `candle_ledger` / `/api/billing/candle{,/ledger}` | 关键事件后拉 / 服务端推；本地不允许写 | n/a（运营审计可调，不真删） |
| 配额（每日免费 / bonus） | **PG** | Zustand `quotaStore` | `conversation_quota` + `quota_ledger` / `/api/billing/quota` | 服务端 `consumeOneRound` 后回包带新值；本地 setFromServer | n/a |
| 订阅 | **PG** | — | `subscriptions` / `/api/billing/subscription` | 网关 webhook 入账（幂等键 `gateway_event_id`） | 取消走业务流程 |
| 支付流水 | **PG** | — | `/api/pay/{wechat,alipay,stripe}` callback | 仅服务端写 | 不允许删（合规） |

### 6. 内容资产

| 数据 | 真理源 | 本地副本 | 服务端表 / 路由 | 同步策略 | 删除路径 |
|---|---|---|---|---|---|
| 角色卡 `characters` | **服务端**（mock 期 `state.characters`；PG 迁移随 BE-107） | — | `characters` / `/api/characters{,/me/list}` + `/api/admin/characters` | 加载顺序：DB/state → fallback `packages/prompts` 文件；`#characters` 面板写 | `is_active=false` 软删；`packages/prompts` 兜底永远在 |
| 角色解锁 | **PG** | — | `user_character_unlocks` / `/api/me/characters` | 解锁事件落账（含 `source`） | 运营手工 |
| 成就字典 | **PG** | — | `achievements` / `/api/achievements` | 启动拉一次缓存（React Query） | 运营改 `is_active` |
| 用户成就 | **PG** | — | `user_achievements` / `/api/me/achievements` | 触发即写 | 运营审计可清 |
| 问卷 | **PG** | — | `surveys{,_questions,_answers,_completions}` / `/api/surveys/*` | dwell ≥ 5s 校验在服务端 | 运营改 `status` |
| IF 暗号 | **PG** | — | `if_codes` / `if_unlocks` / `/api/if-codes/redeem` + `/api/admin/if-codes` | 兑换不显式提示命中 | 运营 `#if-codes` |

### 7. 运营 / 观测

| 数据 | 真理源 | 本地副本 | 服务端表 / 路由 | 同步策略 | 删除路径 |
|---|---|---|---|---|---|
| 用量规则 `policy_kv` | **服务端**（mock 期 `state.policies`；PG 迁移随 BE-107） | — | `policy_kv` / `/api/admin/policy` | 启动加载 + 内存缓存；`PATCH` 立即 invalidate | 运营改值，不删行（保留审计） |
| 侧袋 AI Prompt | **服务端**（mock 期 `state.sidecarPrompts`；PG/KV 迁移待定） | — | `/api/admin/sidecar-prompts` | 5 个固定 prompt 文本框；保存 reason 落审计；下一轮对话生效 | 不删行，重置为默认 prompt |
| Admin 审计 | **PG**（mock 期 `state.adminAudit`） | — | `/api/admin/audit` | 所有写动作都自动写一行 | 不允许删 |
| 成本记录 | **PG** | — | `cost_records` / `/api/admin/costs` | 每次 LLM 调用入账；熔断器读它 | 不允许删（合规） |
| 埋点事件 / 对话日志 | **PG** | — | `/api/events` + `/api/logs/conversation` | 客户端批量上报；服务端落 `conversation_logs` | 用户"忘了一切"连带删 |

---

## §三　通用规则

### 同步

- **真理源唯一**：同一字段不允许两边都能写。客户端"写本地"必须立即触发"写服务端"，失败进队列重试。
- **冲突解决**：`last-write-wins by updatedAt`。
- **删除走 tombstone**：`deleted_at` 字段；`syncDown` 把 tombstone merge 进本地，本地真删。
- **离线**：本地写不阻塞 UI；上线后 flush 队列；UI 不展示"未同步"红点（避免焦虑），只在长时间失败时通过 `events` 上报。

### 删除（"忘了一切"）

入口：`MemoryPanel` → 二次确认 → 调 `/api/me/memories` `DELETE all` → 服务端真删（不留 tombstone）+ 客户端清 Dexie + 审计落 `adminAudit`（含被删行数，不含明文）。详见 ADR-0005 §后续工作。

### 隐私 / 加密

- 嵌入向量在浏览器算，序列化后走 TLS 上传。
- `preferences.text` / `events.text` 服务端字段级加密静态 — **方案待 BE-115 ADR 拍板**，在那之前 apps/api 明文落盘 `state.json`，仅本地开发用。
- "我的画像"页（FE-112）展示 / 删除 / 导出三件套，给用户控制权。

### 缓存失效

| 触发 | 失效范围 |
|---|---|
| 用户登出 | localStorage `yelan-token` + 内存 store + Dexie 全表 |
| 切账号 | 同上 |
| 用户改 UI 偏好 | `preferencesStore` 立即更新 + debounce 上行 |
| 运营改 policy / characters | 服务端 `/api/admin/*` 写后 invalidate 内存缓存；前端下一次 fetch 拿新值 |
| 运营改侧袋 AI prompt | 同上，下一轮对话生效 |

---

## §四　反向索引（开发者高频问题）

| 我想…… | 看哪 |
|---|---|
| 加新一类长期记忆字段 | §二.2 + BE-102 |
| 加用户级 UI 偏好 | §二.3 + BE-103 / FE-111 |
| 角色卡新增字段 | §二.6 + BE-101 |
| 改默认免费轮次 / 注册赠烛 | §二.7 policy_kv + BE-104 |
| 让某状态跨设备同步 | 先决定真理源 → 进 §二 对应分类 → 走 ADR-0005 范式 |
| 删干净一个用户 | §三.删除 + 运营 `#users` 详情页（AD-105） |
| 给某字段加加密 | BE-115 ADR-0006 |

---

## §五　与现有文档的关系

- **取代**：旧 `apps/web/src/memory/README.md` "本地是真理源 / 不上传" 段（已在 ADR-0005 同步改完）
- **被引**：[README §设计原则](../../README.md) #5 / [structure.md §关键工程约定](../structure.md) #5 / [`apps/web/src/memory/README.md`](../../apps/web/src/memory/README.md)
- **下游 ADR**：BE-115 字段级加密静态（待开 ADR-0006）

---

## §六　变更日志

| 日期 | 变更 |
|---|---|
| 2026-05-18 | 补充前端本机会话快照：`localStorage yelan.chatSession.<characterId>` 只用于当前设备续聊；`/api/chat` 对未知 `sessionId` 自动 upsert 服务器会话；"清除本机对话"不删除服务器会话、消息、记忆或暗号状态 |
| 2026-05-08 | 初版 — DOC-101，落 ADR-0005 拍板的数据分工口径 |
