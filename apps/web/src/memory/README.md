# 本地记忆系统（缓存层）

> 决策来源：[ADR-0005 账号绑定的全量状态同步](../../../../docs/tech/adr/0005-account-bound-state.md)
> 全量分工表：[docs/architecture/data-locality.md](../../../../docs/architecture/data-locality.md)

## 定位变更

**旧**（已废弃）：本地记忆是真理源，绝不上传 — 修订 #17 / #23 / #31。

**新**（ADR-0005 起）：**服务端是真理源**。本地 Dexie 只是：

1. **离线缓存** — 网络抖动时 recall 仍可用
2. **嵌入计算的临时存储** — bge-small-zh 仍在浏览器跑（隐私 + 成本）
3. **未登录访客模式的临时空间**

## 模块

- **db.ts** — Dexie schema（preferences / events，含 mode='main'|'if'）
- **embedder.worker.ts** — transformers.js + bge-small-zh-v1.5
- **recall.ts** — top-K 召回；流程改为：本地优先 → cache miss 时拉服务端补
- **keyword-fallback.ts** — 低端机降级到 jieba+BM25
- **sync.ts** — TODO（FE-110）：双向同步本地 Dexie ↔ 服务端 PG

## 同步策略（待实现，FE-110 / BE-110）

- 启动时：拉 `/api/me/memories?since=<lastSyncTs>`，merge 进本地
- 写入时：本地立刻写 + 异步 POST `/api/me/memories`，失败回退队列重试
- 冲突：last-write-wins by `updatedAt`；删除走 tombstone
- 离线：本地写不阻塞；上线后 flush 队列

## "忘了一切"

入口在 `MemoryPanel`。二次确认；**服务端真删** + 本地清。审计走 `/api/admin/audit`。

## 隐私

- 嵌入向量：浏览器算，向服务端发送时序列化为 BYTEA（PG）；TLS 在传输层
- 文本字段：服务端字段级加密静态（具体方案在安全 ADR 决定，BE-115）
- 用户可见的"我的画像"页（`#you` 抽屉）展示什么、删什么、导出什么 — 详见 FE-114
