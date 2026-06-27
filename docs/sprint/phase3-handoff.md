# 夜阑 Phase 3 任务派单 — 主后端生产化

> **Handoff 文档** | 给开发部的正式任务派单与工作流说明
> **范围**：2 个 sprint（A：数据层硬仗 / B：收尾 + e2e）
> **协作模型**：同机单人 / AI 代理轮流干，直接在 sprint 分支上 commit；分支整体完成后合回 main

---

## TL;DR

Phase 2 已合 main，`pnpm verify:gray` 全绿、113 tests passed。**主后端生产化（Phase 3）开干**。

工作拆 2 个 sprint：

- **Sprint A**（~2 周）：BE-139 改名 + BE-140 Postgres 接入 + BE-141 迁移脚本 + INFRA-105 Docker prod + DOC-104 runbook 草稿。**数据层硬仗。**
- **Sprint B**（~1 周）：INFRA-108 监控告警 + TEST-109 e2e + DOC-104 runbook 终稿。**收尾 + 验证。**

**Sprint A 启动前置已完成**：[ADR-0010](../tech/adr/0010-persistence-postgres-decision.md) 已 **Accepted (2026-05-14)**，4 个决策点全部拍板（D1=Managed PG / D2=混合 schema / D3=一次性脚本 / D4=Managed free tier 备份）。BE-140 schema 直接按 phase3-postgres.md 已草拟的 7 表 + app_kv 走。

---

## 怎么开始

### Sprint A 开工

ADR-0010 决策会 2026-05-14 已完成，直接建分支开干：

```bash
git checkout main
git checkout -b sprint/phase3a
pnpm install --frozen-lockfile
pnpm verify:gray   # 必须全绿才开干（基线 113 tests）
```

### Sprint B 开工前置

Sprint A 整体合回 main 之后再开 Sprint B 分支：

```bash
git checkout main
git checkout -b sprint/phase3b
pnpm verify:gray
```

Sprint B 工单详情会在 Sprint A 收尾时根据实际落地情况补到 `docs/sprint/phase3-monitoring-e2e.md`（待创建）。

---

## 工作流（本地直 commit 模式）

**直接在 sprint 分支上 commit，不开 sub-branch、不发 PR。**

### 每次开干

```bash
# 1. 确认在对的分支
git status                                     # 看 "On branch sprint/phase3a"

# 2. 改代码...

# 3. 跑门禁
pnpm verify:gray                               # 必须全绿

# 4. 暂存 + 提交
git add <相关文件>                              # 不要 git add . —— 防止误带文件
git commit -m "feat(scope): xxx (BE-NNN)"
```

### Commit message 规范（强制）

```
<type>(<scope>): <一句话描述> (<工单 ID>)
```

- `type`: feat / fix / refactor / test / docs / chore / infra
- `scope`: server / api / web / admin / shared / scripts / db / infra
- 必须带工单 ID（`BE-139` / `BE-140` / `INFRA-105` 等）
- 一个 commit 一件事（**例外**：强相关的小工单可合一 commit，但 commit message 必须列全所有工单 ID，如 `(BE-137, BE-138)` — Phase 2 红线调整后的新规则）

例子：

```
feat(api): postgres connection layer (BE-140)
feat(api): replace persistence with pg-backed store (BE-140)
chore(scripts): migrate state.json to postgres (BE-141)
infra: docker compose with postgres service (INFRA-105)
refactor: rename apps/mock-server to apps/api (BE-139)
```

### 红线（不允许）

- ❌ 跳过 `pnpm verify:gray` 强 commit
- ❌ `--no-verify` skip git hooks
- ❌ commit message 不带工单 ID
- ❌ 一个 commit 改超过 1 个**不相关**工单（强相关的可以，见上）
- ❌ 代码或 commit message 里 hardcode `DATABASE_URL` / `INTERNAL_TOKEN` 真实值
- ❌ 改 `apps/server/src/routes/{auth,pay/*,db/*,llm/providers/*}.ts` — ADR-0008 明确保留的 stub，Phase 5 上线时才接
- ❌ 在 main 分支上 commit 业务代码（main 只接 sprint 合并；规划文档可直 commit main）
- ❌ 偏离 ADR-0010 决策动手写 schema（决策已 Accepted，要改回头开补议会，不在 sprint 分支自由发挥）

---

## 任务分配

### 🔴 Sprint A — 数据层硬仗（5 件 + ADR-0010 决策）

详情：[`docs/sprint/phase3-postgres.md`](phase3-postgres.md)
决策依据：[`docs/tech/adr/0010-persistence-postgres-decision.md`](../tech/adr/0010-persistence-postgres-decision.md)（**先开会拍板**）

| 工单 | 给谁 | 预算 | 依赖 |
|---|---|---|---|
| **BE-139** apps/mock-server → apps/api 改名 | 后端 A | 半天 | — |
| **BE-140** Postgres 持久化层（schema + 连接 + store 重写） | 后端 B | 2-3 d | — (ADR-0010 已 Accepted) |
| **BE-141** state.json → PG 一次性迁移脚本 | 后端 B（与 BE-140 同人） | 半天 | BE-140 基本完成 |
| **INFRA-105** Docker 生产 compose + PG 配置 | 运维 | 1 d | ADR-0010 D1 拍板 |
| **DOC-104（草稿）** 生产部署 runbook | 文档 / 架构 | 半天 | INFRA-105 配齐 |

### 🟢 Sprint B — 收尾 + 验证（3 件）

工单详情待 Sprint A 收尾时落档到 `docs/sprint/phase3-monitoring-e2e.md`。

| 工单 | 给谁 | 预算 | 依赖 |
|---|---|---|---|
| **INFRA-108** `/health` 接监控告警（UptimeRobot / CF Healthcheck） | 运维 | 半天 | INFRA-105 已部署 |
| **TEST-109** e2e 测试：注册 → 选角 → 对话 → 消费 candle | 测试 | 2-3 d | Phase 3A 全部合 main |
| **DOC-104（终稿）** 生产部署 runbook | 文档 / 架构 | 半天 | INFRA-108 配齐 |

---

## ⚠️ 必读：BE-139 ↔ BE-140 顺序

**两条路线，选其一**：

### 路线 P（推荐）— BE-139 先 commit

```
1. BE-139 commit（apps/mock-server → apps/api 改名）
2. BE-140 commit（在新名字下接 PG）
3. BE-141 commit（迁移脚本读旧 state.json 写 PG）
4. INFRA-105 commit（compose 引用 apps/api）
```

**好处**：BE-140 / BE-141 的代码路径一开始就是最终路径，不用二次改 import。
**代价**：BE-139 是个跨 ~50 个文件的大改名，commit diff 很吵。

### 路线 Q — BE-140/141 先做，最后改名

```
1. BE-140 commit（仍叫 mock-server，接 PG）
2. BE-141 commit（迁移脚本）
3. INFRA-105 commit（compose 引用 mock-server）
4. BE-139 commit（统一改名 mock-server → api，含 compose）
```

**好处**：BE-140 的功能 commit 更聚焦。
**代价**：INFRA-105 写两遍配置（一次旧名一次新名）。

**默认采用路线 P**。如果 ADR-0010 决策会上发现 BE-139 风险高，再切路线 Q。

---

## 入场命令（每次 commit 前必跑）

```bash
# 主门禁
pnpm verify:gray

# 模式纪律（必须 0 行）
grep -rn 'Schema\.parse(await c\.req\.json())' apps/mock-server/src/routes apps/api/src/routes 2>/dev/null

# Sprint A 期间新增：DATABASE_URL 不允许硬编码
grep -rn 'postgresql://[a-zA-Z]' apps/ scripts/ 2>/dev/null | grep -v '.env.example'
# 期望：0 行（除了 .env.example 的占位）
```

任一红灯 = 不要 commit。

---

## sprint 分支合回 main

每个 sprint 单独合，**不要把 phase3a 和 phase3b 合并成一个**：

```bash
# Sprint A 合回
git checkout sprint/phase3a
git status   # working tree clean
pnpm verify:gray   # 最终全绿

git checkout main
git merge --no-ff sprint/phase3a -m "merge: Phase 3A — postgres + rename + docker prod"
pnpm verify:gray   # 验证 main 仍全绿

# Sprint B 合回（Sprint B 完成后）
git checkout sprint/phase3b
pnpm verify:gray
git checkout main
git merge --no-ff sprint/phase3b -m "merge: Phase 3B — monitoring + e2e + runbook"
pnpm verify:gray
```

---

## 文档导航（按需查）

| 想知道什么 | 看哪 |
|---|---|
| 整体上线形态 / 为什么这么干 | [`docs/tech/adr/0008-deployment-shape-decision.md`](../tech/adr/0008-deployment-shape-decision.md)（含 mermaid 顶层图） |
| INTERNAL_TOKEN 怎么设计的 | [`docs/tech/adr/0009-internal-token-design.md`](../tech/adr/0009-internal-token-design.md) |
| Postgres 4 个决策点 | [`docs/tech/adr/0010-persistence-postgres-decision.md`](../tech/adr/0010-persistence-postgres-decision.md) |
| 所有任务 ID 在哪 | [`docs/TODOlist.md`](../TODOlist.md) |
| 接口现状 / 哪些 stub 不要碰 | [`接口审计与TODO.md`](../../接口审计与TODO.md) |
| Phase 2 交付细节（已合 main） | [`docs/sprint/2026-05-14-report.md`](2026-05-14-report.md) |
| **当前 Sprint A 工单详情** | [`docs/sprint/phase3-postgres.md`](phase3-postgres.md) |
| 当前 Sprint A handoff | 本文档 |
| Sprint B 工单详情 | 待 Sprint A 收尾时创建 `docs/sprint/phase3-monitoring-e2e.md` |
| Secrets 管理 SOP（含 DATABASE_URL 操作） | [`docs/operations/secrets-management.md`](../operations/secrets-management.md) |

---

## 节奏建议

### Sprint A（~2 周）

- **Week 1**
  - Day 1：BE-139 改名 + BE-140 schema 起手
  - Day 2-4：BE-140 连接层 + 核心实体（users / sessions / messages / quota）
  - Day 5：BE-140 长尾实体（app_kv）+ 自测
- **Week 2**
  - Day 6-7：BE-141 迁移脚本 + 跑通本地 state.json → PG
  - Day 8：INFRA-105 Docker compose + PG 联动
  - Day 9：DOC-104 草稿 + 全链路演练
  - Day 10：收尾 + 合 main

### Sprint B（~1 周）

- Day 1-2：INFRA-108 监控接好
- Day 3-5：TEST-109 e2e 写 + 跑
- Day 6：DOC-104 终稿 + 合 main → **Phase 3 完结**

---

## 出问题找谁

- 工单理解问题 → 找架构
- ADR-0010 决策没明确的场景 → 回头开会补议，不要自己拍
- `DATABASE_URL` 怎么填 → 找运维 lead（INFRA-107 SOP 流程）
- `pnpm verify:gray` 红了不知道为啥 → 先看 `apps/mock-server/.local/logs/error.log` 找 requestId，再问
- 迁移脚本跑挂了 → **立刻停手**，恢复 `state.json` 备份再分析；不要在生产数据上反复试
- 想撤回一个 commit → `git reset --soft HEAD~1`（保留改动）或 `git reset --hard HEAD~1`（丢弃）；硬重置前先 `git stash`

---

## 一段话版本（如果是丢工作群第一句）

> Phase 2 已合 main，Phase 3 启动。**ADR-0010 4 个决策已 Accepted**（D1=Managed PG / D2=混合 schema / D3=一次性脚本 / D4=Managed free tier 备份），可以直接开干。
>
> Sprint A：`sprint/phase3a` 分支，5 件工单（BE-139 改名 + BE-140 PG 接入 + BE-141 迁移脚本 + INFRA-105 Docker prod + DOC-104 runbook 草稿），~2 周。详见 `docs/sprint/phase3-postgres.md`。
>
> Sprint B：Sprint A 合 main 后开新分支 `sprint/phase3b`，3 件工单（INFRA-108 监控 + TEST-109 e2e + DOC-104 终稿），~1 周。
>
> **红线两条**：(1) 偏离 ADR-0010 决策要回头开补议会，不在分支自由发挥；(2) 迁移脚本跑挂立即恢复 state.json 备份，不在生产数据上试错。
