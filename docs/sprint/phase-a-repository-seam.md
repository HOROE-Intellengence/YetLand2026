# Phase A — 仓储缝（Repository Seam）

> 前置：[ADR-0010 Postgres 持久化决策](../tech/adr/0010-persistence-postgres-decision.md)
> 状态：进行中（2026-06-17 起）
> 目标：在**不改存储**的前提下，把分散的 `store.state()` 访问收口到一组**异步签名**的仓储接口，为后续换 Postgres / SQLite 提供单一支点。

---

## 一　为什么需要这一步

ADR-0010 已拍板「生产换 Postgres」，并定好了部署形态、混合 schema、一次性迁移、备份策略。但它用一句「持久化层重写」（BE-140）带过了真正的硬骨头：

> **`store.state()` 被调用 353 次，散在 40+ 文件里**，全是「同步读 → 就地改内存对象 → `store.save()`」的模式。

`state.json` 不是问题本身，**「业务代码直接同步操作一个内存大对象」才是**。Postgres 是异步 I/O，`store.state().users[id].candle -= 1` 没法原地换成一句 SQL——这 353 处每一处都要从同步改成 `await repo.xxx()`。

直接照 ADR 写 PG 实现 = 一次性改 353 处 + 同步转异步 + 不可回滚。**正确顺序是先让后端"可替换"，再换后端。** 这就是 Phase A。

当前访问有两种形态，都要收口：

| 形态 | 例子 | 问题 |
|---|---|---|
| **service 层（半成品 repo）** | `services/users.ts` 的 `getOrCreateUserByPhone` | 已封装访问，但**同步签名** + **返回活对象让调用方就地改** |
| **route 层直接捅 state** | `routes/sessions.ts` 的 `store.state().sessions[id] = row; store.save()` | 根本没 repo，route 本身就是数据层 |

---

## 二　缝的约定（所有 repo 必须遵守）

1. **方法签名一律 `async`（返回 `Promise`）** —— 即便 JSON 实现是同步的，也包成 `Promise.resolve(...)`。这样将来换 Postgres 时调用方**不用再改第二次**。这是整个 Phase A 的纪律核心。
2. **落盘由 repo 负责** —— 调用方不再出现 `store.save()`。写方法内部调度落盘。
3. **route / 业务层不再直接访问 `store.state().X`** —— 全部经对应 repo。
4. **写操作走显式方法**（`append` / `update(id, patch)` / `adjust(...)`），不返回活对象让外部就地改。
   - 过渡说明：第一遍迁移可暂时保留「返回活对象做只读」，但**所有写**必须走 repo 方法；换 PG 那一遍再强制 copy-on-read（PG 行本就不是活对象）。
5. **不改行为** —— Phase A 是纯重构，id 前缀、字段、保留上限、审计落点全部与改造前逐字节一致。`verify:gray` 全绿是每个切片的验收线。

---

## 三　仓储清单（按 ADR-0010 D2 的「核心 / 长尾」分）

**核心实体**（PG 阶段范式化成独立表）：

| repo | 覆盖 `PersistedState` 字段 | 形态 |
|---|---|---|
| `userRepo` | `users` / `tokenIndex` / `phoneIndex` / `emailIndex` | KV + 索引 |
| `quotaRepo` | `quota` | 二级 KV（userId→date） |
| `candleRepo` | `candleLedger` | 只追加 |
| `sessionRepo` | `sessions` | KV |
| `messageRepo` | `messages` | 每会话追加 |
| `conversationLogRepo` | `conversationLogs` | 只追加 + 有界 ← **首个样板** |
| `adminAuditRepo` | `adminAudit` | 只追加 |
| `paymentRepo` | `payments` | 只追加 |
| `membershipRepo` | `membershipPlans` / `subscriptions` | KV |
| `memoryRepo` | `userPreferences` / `userEvents` | KV + 软删 |
| `profileRepo` | `userProfiles` / `userProfileFacts` / `userProfileChangelog` / `contextSummaries` / `temperatureLogs` | KV |
| `achievementRepo` | `userAchievements` | KV |
| `surveyRepo` | `surveys.definitions` / `surveys.submissions` | KV + 追加 |
| `characterRepo` | `characters` / `constellations` / `preludeCards` | KV |
| `ifCodeRepo` | `ifCodes` / `ifRedemptions` | 数组 + 追加 |

**长尾实体**（PG 阶段进 `app_kv` 单表 JSONB）：

| repo | 覆盖字段 |
|---|---|
| `configRepo` | `policies` / `sidecarPrompts` / `sidecarEnabled` / `sidecarOrder` / `llmApiInventory` / `prompts.versions` / `costsDaily` / `freeLimitOverride` |

> 现有 `services/{users,characters,memories,membership,constellations,llm-api-inventory,policy,if-unlock}.ts` 就是这些 repo 的雏形：迁移时把它们**改成 repo 的调用方或并入 repo**，而不是另起炉灶。

---

## 四　迁移顺序（风险升序，逐文件落）

每个切片独立 commit、独立过 `verify:gray`。

1. **`conversationLogRepo`**（2 调用点，只追加）← 本次样板，验证模式
2. `adminAuditRepo`（只追加，多为 `appendAudit` 单一写法）
3. `achievementRepo`（1 调用点）
4. `sessionRepo` + `messageRepo`（`routes/sessions.ts` 4 点，自包含）
5. `surveyRepo` / `memoryRepo` / `profileRepo`
6. `characterRepo` / `constellationRepo` / `preludeCardRepo`（service 已存在）
7. `configRepo`（admin 路由 + `llm-api-inventory` 11 点）
8. **`userRepo` + `quotaRepo` + `candleRepo`**（hub，扇入最高，最后做，模式已被前面验证过）

---

## 五　首个样板：`conversationLogRepo`

改造前（`routes/logs.ts` / `routes/events.ts` 各一处）：

```ts
import { store, pushBounded, LOG_RETENTION } from '../store/persistence';
pushBounded(store.state().conversationLogs, {
  id: `log_${randomUUID().slice(0, 8)}`, userId, sessionId, payload: body,
  createdAt: new Date().toISOString(),
}, LOG_RETENTION.conversationLogs);
store.save();
```

改造后：

```ts
import { conversationLogRepo } from '../store/repositories';
await conversationLogRepo.append({ userId, sessionId, payload: body });        // logs.ts
await conversationLogRepo.append({ userId, sessionId: 'telemetry', payload: body, idPrefix: 'tlm' }); // events.ts
```

仓储实现见 [`apps/api/src/store/repositories/conversation-log.repo.ts`](../../apps/api/src/store/repositories/conversation-log.repo.ts)。
`id` 生成、`createdAt`、保留上限、落盘全部移入 repo；route 不再 import `pushBounded` / `LOG_RETENTION` / `randomUUID`。**行为零变化**（`log_` / `tlm_` 前缀保留）。

---

## 六　完成定义

- [ ] 17 个 repo 接口全部建立，`store.state()` 直接访问从 353 → 0（仅 repo 内部保留）
- [ ] 所有 repo 方法 async 签名，调用方无 `store.save()`
- [ ] 每个切片 `verify:gray` 全绿、行为零变化
- [ ] 完成后，换 Postgres = 只动 `store/repositories/*` 的实现 + 加 `PERSISTENCE=json|pg` flag，业务层零改动
