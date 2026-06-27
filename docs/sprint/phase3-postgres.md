# Sprint Phase 3A：主后端生产化 — Postgres 接入

> **窗口**：~2 周
> **目标**：把 `apps/mock-server` 改名 `apps/api`、Postgres 替换 state.json、Docker 生产 compose 就绪、部署 runbook 草稿出
> **前置**：
> - [ADR-0008](../tech/adr/0008-deployment-shape-decision.md) 方案 A（已 Accepted）
> - [ADR-0010](../tech/adr/0010-persistence-postgres-decision.md) 4 个决策点（**Proposed → 必须开会拍板后才开工**）
> **总入场命令**：`pnpm verify:gray`（全绿才能 commit）

---

## 工单概览

| ID | 标题 | 优先级 | 预算 | 依赖 | 负责人 |
|---|---|---|---|---|---|
| **ADR-0010 决策会** | PG 4 个决策点拍板 | P0 | 1 h | — | 架构 + PM + 运维 + 后端 lead |
| **BE-139** | `apps/mock-server` → `apps/api` 改名 | P2 | 半天 | — | _待分配_ |
| **BE-140** | Postgres 持久化层（schema + 连接 + store 重写） | P0 | 2-3 d | ADR-0010 | _待分配_ |
| **BE-141** | state.json → PG 一次性迁移脚本 | P0 | 半天 | BE-140 基本完成 | _待分配_ |
| **INFRA-105** | Docker 生产 compose + PG 配置 | P0 | 1 d | ADR-0010 D1 | _待分配_ |
| **DOC-104（草稿）** | 生产部署 runbook | P0 | 半天 | INFRA-105 配齐 | _待分配_ |

### Commit 顺序（路线 P — 推荐）

```
ADR-0010 决策会 commit（落决策表）
  ↓
BE-139 改名（独立可早做）
  ↓
BE-140 schema + 连接层
  ↓
BE-140 store 重写（核心实体 → 长尾）
  ↓
BE-141 迁移脚本
  ↓
INFRA-105 Docker compose（含 PG）
  ↓
DOC-104 草稿
  ↓
sprint/phase3a 合 main
```

**关键约束**：BE-140 schema 必须落 ADR-0010 D2 决策后才写。否则 schema 与决策不符 = 100% 返工。

### 通用规则

- 每个 commit 前本地 `pnpm verify:gray` 全绿
- 不允许 hardcode `DATABASE_URL` 真实值（用 `.env` + `.env.example` 占位）
- 不允许新增 `Schema.parse(await c.req.json())` 残留
- 一 commit 一工单（强相关小工单可合，需列全 ID）

---

## BE-139 — apps/mock-server → apps/api 改名

**优先级**：P2 | **预算**：半天 | **依赖**：—

### 背景

ADR-0008 §"形态变化的硬性后果"明确：**`apps/mock-server` 改名 `apps/api` 消除语义错位**。这个名字现在生产上线时会让人误以为是"mock 服务"，运维心智混乱。

技术上是纯改名，无逻辑变化。但跨 ~50 个文件 + scripts + workspace 配置，需要一次性扫干净。

### 改什么

**1. 目录改名**

```bash
git mv apps/mock-server apps/api
```

**2. 包名改**

`apps/api/package.json`：
```json
{
  "name": "@yelan/api",   // 从 @yelan/mock-server
  ...
}
```

**3. Workspace 引用**

- `pnpm-workspace.yaml` — 无需改（pattern `apps/*` 自动覆盖）
- 根 `package.json` 内任何 `--filter @yelan/mock-server` → `@yelan/api`
- 各子 package.json 内 dependency `"@yelan/mock-server": "workspace:*"` → `@yelan/api`

**4. 脚本扫**

```bash
# 找出所有引用 mock-server 名字的地方
grep -rn 'mock-server' --include='*.json' --include='*.ts' --include='*.tsx' --include='*.mjs' --include='*.md' --include='*.toml' --include='*.yaml' .
```

需要改的常见点：
- `package.json` 根 `scripts.*` 里 `pnpm --filter @yelan/mock-server` / `apps/mock-server` 路径
- `scripts/check-api-contracts.mjs` 等扫描脚本里硬编码的路径
- `apps/server/src/routes/mock-fallback.ts` 里日志 / 注释（功能名仍叫 mock-fallback，因为这是 ADR-0007 的历史名 — 不改）
- `apps/admin/` / `apps/web/` 任何引用
- README 文档、ADR 内的路径引用、CLAUDE.md

**5. 路径常量扫**

```bash
grep -rn '\.local/state\.json' .
```

`apps/api/src/store/persistence.ts:9` 当前有 `resolve(here, '..', '..', '.local')` — 改名后路径不变，但要把注释里的 `apps/mock-server` 改 `apps/api`。

**6. `mock-fallback` 名字保留**

ADR-0007 定义的 fallback 机制名是历史名，**不改**，避免 ADR / 测试连锁改动。仅注释里点明"代理目标已改名为 apps/api"。

### 验收

```bash
# 1. 改完后所有 grep 都应为空（除了刻意保留的）
grep -rn '@yelan/mock-server' apps/ scripts/ *.json *.yaml 2>/dev/null
grep -rn 'apps/mock-server' apps/ scripts/ docs/ *.md *.json *.yaml 2>/dev/null | grep -v ADR-0008 | grep -v '历史'
# expected: 仅历史文档（如 ADR / report）保留对历史名的引用

# 2. 门禁
pnpm install   # workspace name 改了要刷新
pnpm verify:gray   # 必须全绿，113 tests 应仍全过

# 3. 启动两边都跑得起来
pnpm dev:mock   # 改名后这个 script 也应改名为 dev:api，但本工单可保留旧 alias 作过渡
```

### Commit 建议

**单 commit**（diff 大但纯机械改名）：
```
refactor: rename apps/mock-server to apps/api per ADR-0008 (BE-139)
```

如果 diff 实在太吵，可拆 2 个：
1. `refactor: rename apps/mock-server directory to apps/api (BE-139)` — `git mv` + package.json
2. `refactor: update all references from mock-server to api (BE-139)` — 所有 grep 改

### 关联

- [ADR-0008](../tech/adr/0008-deployment-shape-decision.md) §"形态变化的硬性后果"
- mock-fallback 历史名保留（ADR-0007 不动）

---

## BE-140 — Postgres 持久化层

**优先级**：P0 | **预算**：2-3 d | **依赖**：ADR-0010 拍板

### 背景

`apps/api/src/store/persistence.ts` 当前把 28+ 个实体存到 `.local/state.json`，单进程内存 + 200ms 防抖写文件。生产必须替换为 Postgres，让 `apps/api` 能容器化 + 水平扩展。

本工单实装 PG 持久化层，**先与 state.json 并存**（通过 `PERSISTENCE` env 切换），不删旧实现 — BE-141 迁移完后再清掉。

### 改什么

> 以下假设 ADR-0010 D2 = C（混合：核心范式化 + 长尾 JSONB）。如果决策会选了别的，schema.sql 需调整。

#### 1. 新建 `infra/db/schema.sql`

```sql
-- ADR-0010 D2=C 混合方案：核心 7 表 + 1 张 KV 表

-- 用户主表
CREATE TABLE users (
  id              TEXT PRIMARY KEY,
  phone           TEXT UNIQUE NOT NULL,
  token           TEXT UNIQUE NOT NULL,
  age_verified    BOOLEAN NOT NULL DEFAULT FALSE,
  narrative_boundary SMALLINT NOT NULL CHECK (narrative_boundary BETWEEN 1 AND 5),
  if_unlocked     BOOLEAN NOT NULL DEFAULT FALSE,
  candle          INTEGER NOT NULL DEFAULT 0,
  register_grant  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX users_token_idx ON users (token);
CREATE INDEX users_phone_idx ON users (phone);

-- 会话
CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id  TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN ('main', 'if')),
  if_active     BOOLEAN NOT NULL DEFAULT FALSE,
  round         INTEGER NOT NULL DEFAULT 0,
  prev_stage    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- 消息（高频读写，独立表 + 复合索引）
CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX messages_session_created_idx ON messages (session_id, created_at);

-- 每日配额
CREATE TABLE quota_daily (
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        DATE NOT NULL,
  free_used   INTEGER NOT NULL DEFAULT 0,
  bonus_used  INTEGER NOT NULL DEFAULT 0,
  bonus_limit INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, date)
);

-- candle 流水（不可变）
CREATE TABLE candle_ledger (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta       INTEGER NOT NULL,
  reason      TEXT NOT NULL,
  ref_id      TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX candle_ledger_user_idx ON candle_ledger (user_id, created_at);

-- 对话日志（结构化，含 SSE 全文）
CREATE TABLE conversation_logs (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  session_id  TEXT NOT NULL,
  payload     JSONB NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX conversation_logs_session_idx ON conversation_logs (session_id, created_at);

-- 管理员审计
CREATE TABLE admin_audit (
  id        TEXT PRIMARY KEY,
  ts        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action    TEXT NOT NULL,
  actor     TEXT NOT NULL,
  target    TEXT,
  reason    TEXT,
  payload   JSONB
);
CREATE INDEX admin_audit_ts_idx ON admin_audit (ts DESC);

-- 支付
CREATE TABLE payments (
  id        TEXT PRIMARY KEY,
  provider  TEXT NOT NULL,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount    INTEGER NOT NULL,
  status    TEXT NOT NULL,
  ts        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX payments_user_idx ON payments (user_id, ts DESC);

-- 长尾配置 / 应用状态（低频 JSONB）
CREATE TABLE app_kv (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- 装：sidecarPrompts / userProfiles / contextSummaries / temperatureLogs /
--    llmApiInventory / policies / freeLimitOverride / promptsVersions /
--    costsDaily / characters / preludeCards / ifCodes / ifRedemptions /
--    surveys.definitions / surveys.submissions /
--    userAchievements / userPreferences / userEvents / userUIPreferences
```

> 决策会如果选 D2=A（完全镜像）或 D2=B（完全范式化），此节重写。

#### 2. 新建 `apps/api/src/store/pg.ts`

PG 连接 + 池化 + 优雅关闭：

```ts
import { Pool } from 'pg';
import type { PoolClient } from 'pg';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL && process.env.PERSISTENCE === 'postgres') {
  throw new Error('DATABASE_URL required when PERSISTENCE=postgres');
}

export const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: Number(process.env.PG_POOL_MAX ?? 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    })
  : null;

export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  if (!pool) throw new Error('pg pool not initialized');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// 优雅关闭
if (typeof process !== 'undefined') {
  const shutdown = async () => {
    if (pool) await pool.end();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
```

#### 3. 重写 `apps/api/src/store/persistence.ts`

保持 `store.state()` API 不变（避免改 50+ 处调用方），但内部根据 `PERSISTENCE` env 选实现：

```ts
const PERSISTENCE = process.env.PERSISTENCE ?? 'jsonfile';

export const store = PERSISTENCE === 'postgres'
  ? createPgStore()    // 新实现
  : createFileStore(); // 现有 state.json 实现，整体保留作 fallback
```

`createPgStore` 大致结构：
- `state()` 不能再返回整对象（PG 不该一次性 SELECT * FROM all_tables）；改造为按需查询 API
- 或：保留 `state()` 接口但在背后做"读缓存 + 写直通 PG"

**关键设计抉择**（ADR-0010 D2 未覆盖的细节）：

| 方案 | 描述 | 代价 |
|---|---|---|
| **a. 全惰性查询** | 改造所有调用方从 `store.state().users[id]` → `await store.users.getById(id)` | 改 50+ 处 |
| **b. 启动时全量加载到内存** | 保持现有调用方式，写时同步到 PG | 内存吃紧、扩 instance 状态分歧 |
| **c. 读缓存（LRU）+ 写直通** | 折中 | LRU 失效与一致性边界要想清楚 |

**建议**：本 sprint 选 **a** — 一次性改干净。`store.state()` 改造为细分 API（`store.users.getByToken(token)` / `store.sessions.getByUser(userId)` 等），与 PG 查询天然对齐。改完后 50+ 处调用方也都点一遍。

#### 4. apps/api 依赖

```json
// apps/api/package.json
"dependencies": {
  "pg": "^8.13.0"
}
"devDependencies": {
  "@types/pg": "^8.11.0"
}
```

#### 5. `.env.example` 加占位

```bash
# Postgres（ADR-0010）
DATABASE_URL=postgresql://user:pass@host:5432/yelan
PERSISTENCE=postgres   # 或 jsonfile（开发态默认）
PG_POOL_MAX=10
```

### 验收

```bash
# 1. typecheck + 跑当前测试（PG 未配时仍走 jsonfile）
pnpm verify:gray   # 必须全绿

# 2. 起本地 PG（Docker）
docker run -d --name yelan-pg-test -p 5433:5432 \
  -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=yelan postgres:16
psql postgresql://postgres:devpass@localhost:5433/yelan -f infra/db/schema.sql

# 3. 启 api 接 PG
DATABASE_URL=postgresql://postgres:devpass@localhost:5433/yelan \
PERSISTENCE=postgres \
  pnpm --filter @yelan/api dev

# 4. 手测：注册 → 选角 → 对话
curl -X POST http://localhost:8787/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"phone":"13800000001","ageVerified":true}'
# 期望：返回 token，psql 查 SELECT * FROM users 应有这一行

# 5. mock-server 跑全量 89 tests 应仍全过（PG 配了的话用 PG，没配走 jsonfile）
pnpm --filter @yelan/api test

# 6. 清理
docker rm -f yelan-pg-test
```

### Commit 建议（拆 4 个）

```
feat(api): add postgres connection pool layer (BE-140)
feat(api): postgres schema sql + migrations infra (BE-140)
refactor(api): replace store.state() with granular query API (BE-140)
feat(api): pg-backed persistence implementation (BE-140)
```

### 关联

- ADR-0010 D1/D2
- BE-141 是配套迁移脚本

---

## BE-141 — state.json → PG 一次性迁移脚本

**优先级**：P0 | **预算**：半天 | **依赖**：BE-140 基本完成

### 背景

灰测期已经有真实用户数据落在 `apps/api/.local/state.json`，切 PG 时必须把这些数据完整搬过去。ADR-0010 D3 选了"一次性脚本"路线，本工单实装。

### 改什么

**1. 新建 `apps/api/scripts/migrate-state-to-pg.mjs`**

```js
#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { Pool } from 'pg';

const STATE_FILE = process.argv[2] ?? '.local/state.json';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('DATABASE_URL required'); process.exit(1); }

const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
const pool = new Pool({ connectionString: DATABASE_URL });
const client = await pool.connect();

try {
  await client.query('BEGIN');

  // 1. users（含 token/phone index 反查回填）
  for (const [id, u] of Object.entries(state.users ?? {})) {
    await client.query(
      `INSERT INTO users (id, phone, token, age_verified, narrative_boundary,
                          if_unlocked, candle, register_grant, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, u.phone, u.token, u.ageVerified, u.narrativeBoundary,
       u.ifUnlocked, u.candle, u.registerGrant, u.createdAt]
    );
  }

  // 2. sessions
  for (const [id, s] of Object.entries(state.sessions ?? {})) {
    await client.query(
      `INSERT INTO sessions (id, user_id, character_id, mode, if_active,
                             round, prev_stage, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, s.userId, s.characterId, s.mode, s.ifActive ?? false,
       s.round, s.prevStage, s.createdAt, s.updatedAt]
    );
  }

  // 3. messages
  for (const [sessionId, msgs] of Object.entries(state.messages ?? {})) {
    for (const m of msgs) {
      await client.query(
        `INSERT INTO messages (id, session_id, role, content, created_at)
         VALUES ($1,$2,$3,$4,$5)`,
        [m.id, sessionId, m.role, m.content, m.createdAt]
      );
    }
  }

  // 4. quota_daily
  for (const [userId, dates] of Object.entries(state.quota ?? {})) {
    for (const [date, q] of Object.entries(dates)) {
      await client.query(
        `INSERT INTO quota_daily (user_id, date, free_used, bonus_used, bonus_limit)
         VALUES ($1,$2,$3,$4,$5)`,
        [userId, date, q.freeUsed, q.bonusUsed, q.bonusLimit]
      );
    }
  }

  // 5. candle_ledger
  for (const row of state.candleLedger ?? []) {
    await client.query(
      `INSERT INTO candle_ledger (id, user_id, delta, reason, ref_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [row.id, row.userId, row.delta, row.reason, row.refId ?? null, row.createdAt]
    );
  }

  // 6. conversation_logs / admin_audit / payments — 同上展开

  // 7. 长尾全部塞 app_kv
  const kv = {
    sidecarPrompts: state.sidecarPrompts,
    userProfiles: state.userProfiles,
    contextSummaries: state.contextSummaries,
    temperatureLogs: state.temperatureLogs,
    llmApiInventory: state.llmApiInventory,
    policies: state.policies,
    freeLimitOverride: state.freeLimitOverride,
    promptsVersions: state.prompts?.versions,
    costsDaily: state.costsDaily,
    characters: state.characters,
    preludeCards: state.preludeCards,
    ifCodes: state.ifCodes,
    ifRedemptions: state.ifRedemptions,
    surveysDefinitions: state.surveys?.definitions,
    surveysSubmissions: state.surveys?.submissions,
    userAchievements: state.userAchievements,
    userPreferences: state.userPreferences,
    userEvents: state.userEvents,
    userUIPreferences: state.userUIPreferences,
  };
  for (const [key, value] of Object.entries(kv)) {
    if (value === undefined) continue;
    await client.query(
      `INSERT INTO app_kv (key, value, updated_at) VALUES ($1,$2,NOW())`,
      [key, JSON.stringify(value)]
    );
  }

  await client.query('COMMIT');
  console.log('✅ migration complete');
} catch (e) {
  await client.query('ROLLBACK');
  console.error('❌ migration failed:', e);
  process.exit(1);
} finally {
  client.release();
  await pool.end();
}
```

**2. 新建 `apps/api/scripts/verify-migration.mjs`**

读 state.json + 查 PG，逐表对比行数 + 抽样字段：

```js
// 伪代码
const stateUsers = Object.keys(state.users ?? {}).length;
const pgUsers = await client.query('SELECT COUNT(*) FROM users');
if (stateUsers !== Number(pgUsers.rows[0].count)) {
  throw new Error(`users count mismatch: state=${stateUsers} pg=${pgUsers.rows[0].count}`);
}
// 抽样 10 个用户，逐字段对比
// ... 同样对 sessions / messages / quota / candle_ledger
console.log('✅ verification passed');
```

**3. 在 `apps/api/package.json` 加 script**

```json
"scripts": {
  "migrate:to-pg": "node scripts/migrate-state-to-pg.mjs",
  "migrate:verify": "node scripts/verify-migration.mjs"
}
```

### 验收

```bash
# 0. 备份原 state.json（铁律）
cp apps/api/.local/state.json backup/state-$(date +%Y%m%d-%H%M%S).json

# 1. 起干净 PG
docker run -d --name yelan-pg-migrate -p 5434:5432 \
  -e POSTGRES_PASSWORD=devpass -e POSTGRES_DB=yelan postgres:16
psql postgresql://postgres:devpass@localhost:5434/yelan -f infra/db/schema.sql

# 2. 跑迁移
DATABASE_URL=postgresql://postgres:devpass@localhost:5434/yelan \
  pnpm --filter @yelan/api migrate:to-pg apps/api/.local/state.json

# 3. 校验
DATABASE_URL=... pnpm --filter @yelan/api migrate:verify
# expected: ✅ verification passed

# 4. 切 api 读 PG，跑全套 89 tests
DATABASE_URL=... PERSISTENCE=postgres pnpm --filter @yelan/api test
# expected: 89 passed

# 5. 失败演练（必须演练，否则上线惊喜）
# 故意把 schema.sql 里 users 表删了，跑迁移看是否优雅失败 + ROLLBACK
# expected: 报错 + 没有半截数据残留
```

### Commit 建议

```
feat(scripts): state.json → postgres migration script (BE-141)
feat(scripts): postgres migration verification script (BE-141)
```

### 关联

- ADR-0010 D3
- BE-140 是前置（schema 必须先在）

---

## INFRA-105 — Docker 生产 compose + PG 配置

**优先级**：P0 | **预算**：1 d | **依赖**：ADR-0010 D1

### 背景

`apps/api` 容器化部署已有基础（`infra/deploy/`），但 PG 集成方案要看 ADR-0010 D1：

- D1=A（Managed PG）：compose 只起 `apps/api` 容器，DATABASE_URL 指外部
- D1=B（Self-hosted）：compose 起 `apps/api` + `postgres:16` + volume + 备份 cron

本工单按拍板路径写 compose + .env 模板 + 启动文档。

### 改什么（D1=A 路径 — Managed PG）

#### 1. `infra/deploy/docker-compose.production.yml`

```yaml
services:
  api:
    image: yelan-api:${VERSION:-latest}
    build:
      context: ../..
      dockerfile: apps/api/Dockerfile
    restart: unless-stopped
    env_file:
      - .env.production
    environment:
      - PERSISTENCE=postgres
      - NODE_ENV=production
    ports:
      - "8787:8787"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8787/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "443:443"
      - "80:80"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - caddy_data:/data
    depends_on:
      api:
        condition: service_healthy

volumes:
  caddy_data:
```

#### 2. `infra/deploy/.env.production.example`

```bash
# Postgres (managed — Neon / Supabase / Railway)
DATABASE_URL=postgresql://<user>:<pass>@<host>:5432/<db>?sslmode=require
PG_POOL_MAX=10

# INTERNAL_TOKEN（与 Worker secret 同值，ADR-0009）
INTERNAL_TOKEN=
INTERNAL_TOKEN_REQUIRED=true

# Admin token
ADMIN_TOKEN=

# LLM
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
DEEPSEEK_API_KEY=

# 持久化模式
PERSISTENCE=postgres
NODE_ENV=production
```

### 改什么（D1=B 路径 — Self-hosted PG）

替换上面 compose：

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: yelan
    volumes:
      - pg_data:/var/lib/postgresql/data
      - ./schema.sql:/docker-entrypoint-initdb.d/01-schema.sql:ro
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 10s
    # 不暴露端口，仅内网访问

  api:
    # 同上，加：
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/yelan
      - PERSISTENCE=postgres

  # 备份 cron
  pg-backup:
    image: postgres:16-alpine
    restart: unless-stopped
    depends_on: [postgres]
    volumes:
      - ./backups:/backups
    entrypoint: |
      sh -c 'while true; do
        PGPASSWORD=$$POSTGRES_PASSWORD pg_dump -h postgres -U postgres yelan \
          | gzip > /backups/yelan-$$(date +%Y%m%d-%H%M%S).sql.gz
        find /backups -name "yelan-*.sql.gz" -mtime +7 -delete
        sleep 86400
      done'
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}

volumes:
  pg_data:
```

### 验收

```bash
# 1. 本地起完整 compose
cd infra/deploy
cp .env.production.example .env.production
# 填实际值
docker compose -f docker-compose.production.yml up -d
docker compose ps
# expected: 所有服务 healthy

# 2. /health 探活
curl https://api.example.com/health
# expected: {"status":"ok",...}

# 3. 端到端：注册 → 选角 → 对话（同 BE-140 验收）

# 4. （D1=B）备份验证
ls infra/deploy/backups/
# expected: 至少 1 个 yelan-*.sql.gz

# 5. 恢复演练
gunzip -c backups/yelan-XXX.sql.gz | psql $DATABASE_URL
# expected: 数据完整恢复
```

### Commit 建议

```
infra: docker compose production with postgres (INFRA-105)
infra: pg backup cron service (INFRA-105)   # 仅 D1=B 路径
```

### 关联

- ADR-0010 D1 + D4
- INFRA-107 secrets SOP（DATABASE_URL 怎么入库）

---

## DOC-104（草稿）— 生产部署 runbook

**优先级**：P0 | **预算**：半天 | **依赖**：INFRA-105 配齐

### 背景

`infra/deploy/PRODUCTION.md` 当前空缺。运维换人 / 应急部署 / 故障恢复时没有标准手册。本工单出**草稿版**（Sprint A 完成），Sprint B 配合 INFRA-108 监控配齐后出**终稿**。

### 改什么

新建 `infra/deploy/PRODUCTION.md`，至少包含：

```markdown
# 夜阑生产部署 Runbook

## 1. 部署架构

参考 [ADR-0008](../../docs/tech/adr/0008-deployment-shape-decision.md) 顶层架构图。

## 2. 首次部署

### 2.1 前置
- Cloudflare 账号 / Worker 已绑域名
- 服务器（VM）已装 Docker + Docker Compose
- Managed PG 已开（D1=A）或自建 PG 容器准备好（D1=B）

### 2.2 步骤
1. 拉代码
2. 配 `.env.production`（参考 §6 token 清单）
3. `docker compose -f docker-compose.production.yml up -d`
4. 跑迁移：`pnpm migrate:to-pg`（首次部署 + 已有 state.json 时）
5. 部署 Worker：`wrangler deploy`
6. 烟测：`curl https://api.example.com/health`

## 3. 日常运维

### 3.1 查日志
- `docker compose logs -f api`
- 结构化 error log：容器内 `/app/.local/logs/error.log`（卷映射出来）

### 3.2 重启
- `docker compose restart api`
- Worker 重新部署：`wrangler deploy`

### 3.3 数据库操作
- 连入：`docker compose exec postgres psql -U postgres yelan`（D1=B）或外部 psql（D1=A）
- 备份：（D1=A）依赖 managed；（D1=B）每日 cron 自动跑

## 4. 应急处理

### 4.1 服务挂了
- 看 `/health` → 看 `docker compose ps` → 看 `docker compose logs api`
- 重启：`docker compose restart api`

### 4.2 INTERNAL_TOKEN 疑似泄露
按 [ADR-0009 §应急 SOP](../../docs/tech/adr/0009-internal-token-design.md#应急-sop-运维必读)。

### 4.3 数据库挂了 / 数据损坏
- D1=A：联系 managed 客服 + 走 point-in-time recovery
- D1=B：停 api → `psql < backups/yelan-XXX.sql.gz`（解压后） → 启 api → 验证

## 5. 回滚

如果新版本上线后出问题：
```bash
docker compose down
git checkout <上一个稳定 tag>
docker compose -f docker-compose.production.yml up -d
```

数据库 schema 回滚：参考 §4.3 恢复备份。

## 6. Token 与 Secrets 清单

参考 [`docs/operations/secrets-management.md`](../../docs/operations/secrets-management.md)。

## 7. 监控告警

**Sprint B INFRA-108 配齐后补全本节**。
```

### 验收

- 文档 review 通过（架构 + 运维 lead 各 1 个 LGTM）
- 至少跑一遍 §2.2 "首次部署"流程，文档对得上实际操作
- §7 标注"Sprint B 补全"，不算遗留

### Commit 建议

```
docs(infra): production deployment runbook draft (DOC-104)
```

### 关联

- INFRA-105 / INFRA-107 / ADR-0009 / ADR-0010

---

## Sprint Definition of Done

- [ ] **ADR-0010 决策会** 落档，4 个决策填到 §决策汇总表，commit 到 main（非 sprint 分支）
- [ ] **BE-139** commit merged，所有 grep 干净，verify:gray 全绿
- [ ] **BE-140** commit merged，PG 模式下 89 tests 全过
- [ ] **BE-141** commit merged，本地 state.json → PG 迁移 + verify 通过
- [ ] **INFRA-105** commit merged，本地 docker compose up 起得来 + healthy
- [ ] **DOC-104 草稿** commit merged，runbook §1-6 完整
- [ ] **生产演练**：staging 环境完整走一遍部署 → 迁移 → 切流 → 烟测
- [ ] **接口审计与TODO.md / TODOlist.md** 同步 — Phase 3A 工单全标 ✅

---

## Phase 3B 启动条件

Phase 3A 全部 ✅ + 合 main 后，启动 Phase 3B 收尾：

- INFRA-108：`/health` 接监控告警
- TEST-109：e2e（注册 → 选角 → 对话 → 消费）
- DOC-104：runbook 终稿（补 §7 监控）

工单详情待 Phase 3A 收尾时落到 `docs/sprint/phase3-monitoring-e2e.md`。
