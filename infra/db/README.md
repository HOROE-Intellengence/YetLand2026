# 数据库

> 决策见 [ADR-0004](../../docs/tech/adr/0004-db-migration-tool.md)：纯 SQL + 自建 runner + GUI

## 文件

- `schema.sql` —— 当前 schema 的完整快照（人读用）
- `migrations/NNNN_*.sql` —— **真理源**，按顺序应用
- `src/` —— runner / CLI / GUI 代码

## 第一次配置（5 分钟）

1. 装好本地 PostgreSQL 或开一个 Neon 免费实例
2. 在项目根目录的 `.env` 填：
   ```
   DATABASE_URL=postgres://user:pass@host:5432/yelan_dev
   ```
3. 安装依赖（首次）：
   ```bash
   pnpm install
   ```
4. 跑首次迁移：
   ```bash
   pnpm db:up
   ```
   或开图形界面：
   ```bash
   pnpm db:gui
   ```

## 日常工作流

```bash
# 看哪些迁移已应用 / pending
pnpm db:status

# 准备改结构 → 创建新迁移文件
pnpm db:new add_user_nickname
# → 编辑 infra/db/migrations/0002_add_user_nickname.sql

# 应用所有 pending
pnpm db:up

# 想图形界面，所有上面的事都能在浏览器里点
pnpm db:gui
```

## 命名规则

`NNNN_short_description.sql`，NNNN 顺序递增不跳号。每个迁移：

- 必须包含 `BEGIN; ... COMMIT;`（runner 会再包一层 `sql.begin`，多包一次没害）
- 必须可重入（`CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` / `ON CONFLICT DO NOTHING`）
- 不允许 `DROP COLUMN`：要弃用先标 deprecated 字段名注释，至少一个版本后再删

## 紧急通道

- `pnpm db:reset` —— 清空 schema 重跑全部迁移（**仅本地开发库**）。需先设 `MIGRATE_ALLOW_DESTRUCTIVE=true`
- 在 GUI 的"危险区"按钮也走同一逻辑，会弹两次确认

## 它在做什么（理解层）

每跑一次 `db:up`：
1. 确保有一张特殊表 `_migrations`（只有 id、applied_at 两列）
2. 对比 `migrations/` 目录里的文件 vs `_migrations` 表里的行
3. 把缺的 .sql 一个一个跑进去，跑成功就在 `_migrations` 里加一行

不管你跨多少机器、多少环境、停过几次电，规则都一样：**只要 `migrations/` 目录被 git 同步了，所有人的 DB 结构就最终一致**。
