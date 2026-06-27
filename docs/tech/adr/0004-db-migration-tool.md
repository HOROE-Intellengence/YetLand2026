# ADR-0004: 数据库迁移采用纯 SQL + 自建 runner + GUI

- **状态**: Accepted
- **日期**: 2026-05-07
- **决策者**: 工程团队

## 背景

整个项目刚起步，团队 3-4 人，主驾驶员正在学 git。我们需要一个迁移方案：

- 数据库结构变更可追溯到 git 提交
- 多人 / 多环境（本地、测试、生产）一致
- 学习曲线低，初期能完全看懂"每一步发生了什么"
- 不被框架绑死，未来切到 ORM 时迁移文件能 100% 兼容

## 选项

- **A. 纯 SQL + 自建 30 行 Node runner**：迁移就是 `infra/db/migrations/NNNN_xxx.sql`，runner 维护 `_migrations` 表
- **B. Drizzle Kit**：TS schema → 自动生成迁移 + 内置 ORM
- **C. Prisma**：最框架化；Workers 兼容差，需要 Prisma Accelerate（增成本）
- **D. node-pg-migrate / Knex**：成熟工具但 API 较老

## 决策

选 **A**，并追加一个 **GUI**（`infra/db/src/gui/`）作为可视化入口。

理由：
- 学习友好：用户能看懂每个 .sql 文件、`_migrations` 表里的每一行
- 与未来 Drizzle 兼容：纯 SQL 文件，切换工具时不需要重写
- GUI 降低误操作风险（确认弹窗 + 写入模式开关 + 重置闸门）
- 实现成本极低（runner ~150 行，GUI ~400 行单页 HTML）

## 后果

### 工程目录

```
infra/db/
├── package.json              # @yelan/db
├── schema.sql                # 全 schema 快照（人读用）
├── migrations/
│   ├── 0001_init.sql         # 第一版完整 schema
│   └── NNNN_*.sql            # 后续每次结构变更
└── src/
    ├── client.ts             # 连 PG（postgres-js）
    ├── runner.ts             # 核心：list / status / up / new / reset
    ├── cli.ts                # 命令行入口
    └── gui/
        ├── server.ts         # Hono Node 服务
        └── index.html        # 单页 GUI
```

### 用户工作流

| 入口 | 命令 / 动作 |
|---|---|
| 命令行 | `pnpm db:status` / `pnpm db:up` / `pnpm db:new <name>` |
| 图形界面 | `pnpm db:gui` → 浏览器 `http://localhost:5174` |

两者底层共用 `runner.ts`，行为完全一致。

### 安全门

- `reset`（DROP SCHEMA）需要环境变量 `MIGRATE_ALLOW_DESTRUCTIVE=true` 才能执行
- GUI 的"写入模式"默认关闭，临时查询走 read-only 事务
- 生产 DATABASE_URL 严禁出现在本地 `.env`

### 升级路径

- 当迁移数 >50 或 SQL 复杂度上升 → 切 Drizzle Kit。`migrations/*.sql` 直接喂给 Drizzle 的 `drizzle-kit migrate`
- 当 GUI 功能增多（数据浏览 / ER 图 / RLS 调试） → 评估替换为 Drizzle Studio 或 pgAdmin
