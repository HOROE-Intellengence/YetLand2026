# ADR-0010: Postgres 持久化决策（替换 state.json）

- **状态**: **Accepted**
- **日期**: 2026-05-14（草稿 + 决策会同日完成）
- **决策者**: 架构 + PM
- **前置**: [ADR-0008](0008-deployment-shape-decision.md) §"形态变化的硬性后果"明确"生产必须 Postgres"

## 背景

`apps/mock-server`（Phase 3 改名 `apps/api`）当前用 `apps/mock-server/src/store/persistence.ts` 把全部业务状态写到 `.local/state.json`：

- **数据规模**：一个 JSON 文件，28+ 个顶层实体（users / quota / sessions / messages / candleLedger / surveys / ifCodes / payments / characters / preludeCards / userPreferences / userEvents / userUIPreferences / policies / userAchievements / sidecarPrompts / userProfiles / contextSummaries / temperatureLogs / llmApiInventory / adminAudit / prompts / costsDaily / conversationLogs / ifRedemptions / surveys.submissions ...）
- **持久化机制**：`scheduleSave()` 200ms 防抖 + 进程退出 hook flush；内存里维护 `_state` 对象，所有读写都走它
- **致命缺陷**：
  - 单进程独占，无法水平扩展
  - 整文件读写，500MB 后性能崩
  - 无事务，并发写最后写赢
  - 备份 = `cp state.json`（INFRA-101-CRON 延后中）

Phase 3 必须替换为 Postgres，让 `apps/api` 能容器化 + 水平扩展。

本 ADR 决定 **4 个关键决策点**，每个都列了选项，**待会议拍板后把"采纳"标到对应选项上**，再合并到 main。

---

## D1. Postgres 部署形态 — ✅ A 采纳

### 选项

| 选项 | 好处 | 代价 | 决策 |
|---|---|---|---|
| **A. Managed PG（Neon / Supabase / Railway / Render）** | 零运维、自动备份、按用量付费 | 多一跳外网延迟（除非区域同 CF）、价格随用量爆涨 | ✅ |
| **B. Self-hosted Docker PG**（与 `apps/api` 同 compose） | 内网零延迟、可控成本、与现有 Docker 部署一致 | 备份 / 升级 / 监控全自己做（INFRA-105 + INFRA-108 多扛） | ❌ |
| **C. Cloudflare Hyperdrive + 任意外部 PG** | CF 全球连接池，与 Worker 边缘融洽 | 又一层依赖、ADR-0008 方案 A 下 Worker 不直接读 DB（Node 后端读），意义不大 | ❌ |

### 评估维度

- **预期数据量**：灰测期日活 < 1000，单表上限估 ~10 万行。Managed 和 self-hosted 都能轻松扛
- **运维带宽**：当前运维 1 人，倾向少操心
- **成本**：灰测期 Neon free tier / Supabase free tier 已够；上量再说
- **延迟**：`apps/api` 容器与 PG 同主机 vs 跨外网，差 10ms 级（业务无感）

### 拍板理由

**A 选项（Managed PG）** — 灰测期不引入"运维 Postgres"这个新心智模型。如果未来真需要切 self-hosted，schema 不动，只换连接串。具体选 Neon 还是 Supabase 由运维在 INFRA-105 时拍（两者 free tier 均够灰测用量）。

---

## D2. Schema 设计原则 — ✅ C 采纳

### 选项

| 选项 | 好处 | 代价 | 决策 |
|---|---|---|---|
| **A. 直接镜像 state.json 形状**（每个顶层 Record 一张表，主键沿用现有 ID） | 迁移最快、改动最少、回滚容易 | JSONB 字段多、关系建模不充分、未来索引性能差 | ❌ |
| **B. 完整范式化**（拆 messages / sessions / candle_ledger 等明细表，加外键） | 关系清晰、查询性能好、与开发文档 §四 数据库设计对齐 | 工作量大、迁移脚本复杂、灰测窗口紧 | ❌ |
| **C. 混合**（核心实体 users/sessions/messages/quota/candle_ledger 范式化，长尾如 sidecarPrompts/userProfiles/policies 用 JSONB） | 性能与速度平衡，关键查询路径优化 | 需要明确"核心 vs 长尾"边界 | ✅ |

### 核心实体（建议范式化）

参考 `开发文档 §四 数据库设计`，至少：

```sql
users              (id, phone, token, age_verified, narrative_boundary, if_unlocked, candle, register_grant, created_at)
sessions           (id, user_id, character_id, mode, if_active, round, prev_stage, created_at, updated_at)
messages           (id, session_id, role, content, created_at)  -- 高频读写，必须独立表 + (session_id, created_at) 索引
quota_daily        (user_id, date, free_used, bonus_used, bonus_limit)  -- PK (user_id, date)
candle_ledger      (id, user_id, delta, reason, ref_id, created_at)  -- 流水必独立表
conversation_logs  (id, user_id, session_id, payload JSONB, created_at)
admin_audit        (id, ts, action, actor, target, reason, payload JSONB)
payments           (id, provider, user_id, amount, status, ts)
```

### 长尾实体（建议 JSONB 单表）

```sql
app_kv             (key TEXT PRIMARY KEY, value JSONB, updated_at)
-- 装：sidecarPrompts / userProfiles / contextSummaries / temperatureLogs / llmApiInventory / policies
-- 这些都是低频读写、强关联应用配置，JSONB 足够
```

### 拍板理由

**C 选项（混合）**。核心 7 张表 + 1 张 KV 表，覆盖 95% 业务场景。核心边界由"高频读写 + 关系明确"判定（messages 每对话一行、candle_ledger 每扣费一行、sessions 有外键关联），长尾边界由"低频 + 应用配置语义"判定（sidecarPrompts/userProfiles 等）。

---

## D3. 迁移策略 — ✅ A 采纳

### 选项

| 选项 | 好处 | 代价 | 决策 |
|---|---|---|---|
| **A. 一次性脚本**（停服 → 跑 BE-141 脚本 → 起服） | 简单、原子、回滚直接（恢复 state.json） | 停服窗口（估 10 min） | ✅ |
| **B. 双写过渡**（同时写 PG + state.json，验证一致后切读 PG） | 零停服 | 写复杂度翻倍、状态分歧难调试 | ❌ |
| **C. Feature flag 灰度**（按用户 ID 散列切流） | 风险最小化 | 工程量大、灰测窗口装不下 | ❌ |

### 拍板理由

**A 选项**。灰测期日活低，10 分钟停服窗口完全可接受；脚本失败可立刻回滚到 state.json。维护窗口提前 24h 在 admin / 用户告知页公告。

### 一次性脚本要点（BE-141）

```bash
# 0. 备份
cp apps/mock-server/.local/state.json backup/state-$(date +%Y%m%d-%H%M%S).json

# 1. PG schema init
psql $DATABASE_URL -f infra/db/schema.sql

# 2. 跑迁移
node apps/api/scripts/migrate-state-to-pg.mjs --input .local/state.json --db $DATABASE_URL

# 3. 校验
node apps/api/scripts/verify-migration.mjs --db $DATABASE_URL
# 输出：users=N, sessions=M, messages=K, quota=...

# 4. 切流
# 改 apps/api/.env：PERSISTENCE=postgres
docker compose restart api

# 5. 烟测
curl https://api.example.com/api/health
# 灰测白名单用户跑一次注册 → 选角 → 对话流程
```

---

## D4. 备份与恢复 — ✅ A 采纳（free tier 路径）

### 选项

| 选项 | 好处 | 代价 | 决策 |
|---|---|---|---|
| **A1. Managed PG 内置自动备份（free tier）** | 零工作量、零额外成本 | free tier 通常仅保留 24h-7d | ✅ |
| **A2. Managed pro tier PITR（7-30 天）** | 长期保留、point-in-time recovery | $20-30/月起 | ❌（上量后再升） |
| **A3. Managed + 本地 cron pg_dump 双保险** | 防供应商挂、可异地灾备 | 多一份运维负担 | ❌（暂不需要） |
| **B. Self pg_dump + 异地存储**（cron 每日 → S3 / R2） | 供应商无关、可异地灾备 | 自己维护 cron + 恢复演练 | ❌（D1=A 后不适用） |
| **C. 主从复制 + WAL 归档** | RPO ≈ 0 | 灰测期严重过度设计 | ❌ |

### 拍板理由

**A1 选项**。灰测期数据量小、日活低，24h-7d 保留窗口足以覆盖绝大多数误操作场景。**BE-141 迁移脚本跑前必须手动 `pg_dump` 一份冷备**作为兜底（防 managed 在迁移那一刻刚好挂）。

**INFRA-101-CRON 的 state.json 自动备份在 PG 切换后退役**，由 managed PG 自带备份策略替代。

### 升级触发条件（写明，方便未来回查）

- 日活 > 5000 时升 A2（pro tier）
- 接入支付 / 任何"数据丢了赔不起"的业务后升 A3（加本地冷备）

---

## 决策汇总（2026-05-14 决策会落档）

| 决策点 | 选项 | 拍板理由（一句话） |
|---|---|---|
| D1. Postgres 部署形态 | **A. Managed PG** | 灰测期不引入"运维 Postgres"心智模型，free tier 够用，未来切自建只换连接串 |
| D2. Schema 设计原则 | **C. 混合** | 核心 7 表 + app_kv，性能与迁移速度平衡，覆盖 95% 业务场景 |
| D3. 迁移策略 | **A. 一次性脚本** | 停服 ~10 分钟可吃，失败立即恢复 state.json，零数据风险 |
| D4. 备份与恢复 | **A1. Managed free tier** | 24h-7d 保留够灰测期；BE-141 跑前手动 dump 一份冷备兜底 |

---

## 后果

### 直接锁定的工作

**Phase 3 Sprint A**（数据层硬仗）：
- **BE-140**：Postgres 接入（schema.sql + 持久化层重写）
- **BE-141**：state.json → PG 一次性迁移脚本
- **INFRA-105**：Docker 生产 compose（PG 容器 / managed PG 连接串注入）
- **DOC-104**：生产部署 runbook 草稿（PG 操作部分）

**Phase 3 Sprint B**（收尾）：
- **INFRA-108**：监控告警（PG 连接 / 慢查询 / 容量）
- **DOC-104**：runbook 终稿
- **TEST-109**：e2e（覆盖 PG 切换后的全链路）

### 不在本 ADR 范围

- BE-139（apps/mock-server → apps/api 改名）— 与持久化无关，可独立排期
- 用户数据导出 / GDPR 合规 — Phase 5 上线前重审
- 跨区域多主复制 — 上量后再议

## 相关

- [ADR-0008](0008-deployment-shape-decision.md) §"形态变化的硬性后果"：明确"生产必须 Postgres"
- [`apps/mock-server/src/store/persistence.ts`](../../../apps/mock-server/src/store/persistence.ts)：当前 state.json 实现，schema 设计的源数据形状
- `开发文档 §四 数据库设计`（README.md 索引）：原始 schema 草图
- [docs/sprint/phase3-postgres.md](../../sprint/phase3-postgres.md)：本 ADR 决策后落到具体工单
