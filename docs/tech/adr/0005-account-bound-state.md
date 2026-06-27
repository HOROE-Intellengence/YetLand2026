# ADR-0005: 账号绑定的全量状态同步（覆盖"记忆零服务端"）

- **状态**: Accepted（替代之前隐含的"记忆零服务端"原则）
- **日期**: 2026-05-08
- **决策者**: PM + 工程

## 背景

旧原则（README / structure / 开发文档共识）：

> **记忆零服务端** —— Dexie + transformers.js 全在浏览器；server 只存对话日志（脱敏）。
> 修订 #17 / #23 / #31 把这条进一步强化，明确"记忆是护城河，不上行"。

PM 现要求修改：

1. **长期记忆**（`preferences` / `events`）必须上传服务器，与用户账号绑定 — 用户换设备能恢复。
2. **设备 / UI 偏好**（暗色、字号、stage layout 调参）也上传，跨设备一致。
3. 应用商店分发延后；当前前端定位为 **网页端**。这意味着用户从任何浏览器访问都要看到同样的状态 —— 强同步成为刚性需求。

旧方案（本地 Dexie 独占）的硬伤：

- 切设备等于失忆；网页端用户清缓存即丢一切
- 多设备登录无法共享角色关系进度
- 出于商业合规 / 客户支持需要，运营有时必须看用户长期画像

## 选项

- **A** 维持旧方案（仅本地）—— 与 PM 新需求直接冲突。
- **B** 全量上行 —— 长期记忆 + UI 偏好都进 PG。客户端 IndexedDB 仅做读缓存 + 离线兜底。
- **C** 折中云同步开关 —— 默认本地，提供"云同步"加密上行。

## 决策

选 **B**：服务端是状态真理源。客户端 Dexie / IndexedDB 仅用作：

1. 离线缓存（让网络抖动时召回仍可用）
2. 嵌入计算的临时存储（embeddings 仍在浏览器算）
3. 即时 UI 状态（未登录访客模式）

**新原则口径**：

> **服务器是数据真理源，本地仅做缓存。**
> 用户 / 角色 / 长期记忆 / UI 偏好 / 烛账 / 配额 / 会话 — 全部账号绑定，登录即恢复。
> 嵌入仍在浏览器算（隐私 + 成本），但向量本身走"密文上传"或"明文 + 服务端加密静态"两条路，待安全方案最终敲定。

## 后果

### 好处

- 用户网页端、未来 App、未来其他终端体验一致 —— 登录就在
- 运营后台能看到完整画像（合规 / 留存 / 个性化推送依赖）
- 旧的"换设备失忆"槽点消除

### 代价

- 服务端要存敏感数据（preferences 含个人偏好；events 含情感事件）
  → 需要：字段级加密静态、传输 TLS、访问审计、用户"忘了一切"按钮真正删数据
- 每轮对话的 recall 链路从"本地一次"变成"先查缓存、未命中再查服务端"
- 数据库表 schema 多两张：`user_memory_*` + `user_preferences`

### 后续工作（被本决策固化的 TODO）

- `infra/db/migrations/0002_user_memories.sql`：preferences / events / embedding_cache（embedding 字段为 BYTEA）
- `infra/db/migrations/0003_user_preferences.sql`：theme / fontScale / locale / stageLayout 等
- `apps/mock-server/src/routes/me/memories.ts`：CRUD + 召回查询
- `apps/mock-server/src/routes/me/preferences.ts`：upsert / get
- `apps/web/src/memory/sync.ts`：本地 Dexie ↔ 服务端双向同步策略（last-write-wins + 合并）
- `apps/web/src/stores/preferencesStore.ts`：UI 偏好 store + 启动时拉服务端
- `apps/admin/console.html` `#users` 详情页加 "记忆 / 偏好" 子页签
- 隐私：在 `#config` 加用户级"忘了一切"操作（admin 触发）+ 用户可在前端自助删

## 相关 / 取代

- 取代 README §设计原则 #5、structure.md §关键工程约定 #5（"记忆零服务端"）— 已同步改为新口径
- 取代 docs/tech/开发文档.md §一 / §二 / §三.2 / §九 W9 行 / §修订 #17 / #23 / #31 隐含约束 — 已加 ADDENDUM 注明
- 取代 apps/web/src/memory/README.md "跨设备同步？Phase 1 不做" 段
