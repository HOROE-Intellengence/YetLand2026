# 记忆通道现状调研

> 调研日期: 2026-05-21 | 分支: codex/structured-output-flow | 不做决策,仅供 PM 拍板

---

## 1. [她记得] 完整链路

### 1.1 写入源

**数据来源:** 服务端 `preferenceRecorder` 侧袋 AI 的输出 + 前端可能的手动记录(当前未发现直接写入 UI)。

写入路径:
```
preferenceRecorder (每 5 轮) → store.state().userPreferences / userEvents
  → /api/me/memories (GET) 提供增量查询
    → 前端 syncDown() 拉取 → IndexedDB (Dexie: yelan-memory)
```

同步触发点 (`apps/web/src/memory/sync.ts`):
- 应用启动: `fullSync()` (先拉后推)
- 定时器: 每 30s `syncUp()` → `syncDown()`
- 关键事件: 每轮对话完成 `onRoundComplete()` → `syncUp()`

### 1.2 数据形状

**preferences 表** (`PreferenceRow`, Dexie v2):

| 字段 | 类型 | 说明 |
|---|---|---|
| id | number (auto) | Dexie 主键 |
| serverId | string? | 服务端 ID,回填匹配用 |
| characterId | string | 角色 ID |
| text | string | 偏好文本(上限 2000 字符) |
| embedding | Float32Array? | 嵌入向量(上限 4096 维) |
| weight | number | 权重(默认 1) |
| lastUsedAt | number | 最后使用时间戳 |
| mode | 'main' \| 'if' | 所属模式 |
| dirty | boolean? | 未同步标记 |
| tombstone | boolean? | 软删除标记 |
| updatedAt | string? | 更新时间 |

**events 表** (`EventRow`, Dexie v2):

| 字段 | 类型 | 说明 |
|---|---|---|
| id | number (auto) | Dexie 主键 |
| serverId | string? | 服务端 ID |
| characterId | string | 角色 ID |
| date | string | 日期(上限 32 字符) |
| text | string | 事件描述(上限 2000 字符) |
| embedding | Float32Array? | 嵌入向量(上限 4096 维) |
| emotion | string? | 情绪标签(上限 64 字符) |
| mode | 'main' \| 'if' | 所属模式 |
| dirty | boolean? | 未同步标记 |
| tombstone | boolean? | 软删除标记 |
| updatedAt | string? | 更新时间 |

### 1.3 存储位置

- **真源(Truth Source):** 服务端 `store.state().userPreferences` + `store.state().userEvents` (JSON 文件, `state.json`)
- **缓存层:** 浏览器 IndexedDB (`yelan-memory`), Dexie 封装
- **同步模型:** 服务端真理源,客户端 Dexie 缓存;双向增量同步 (since token)

### 1.4 召回排序

触发时机: 每次用户发送消息前 (`useChat.ts:54`)

算法: **纯关键词匹配**,无向量检索(前端未使用 embedding)

```typescript
// recall.ts scoreText():
// - 完整匹配 query → score = 10
// - 按空格分词,每个 token 命中 → score += 1
// - 最终分数 × weight(偏好专属)
// - 过滤 score > 0 → 按 score 降序
```

### 1.5 topK

- 默认 `topK = 5` (调用时传入)
- preferences 取 topK → 最多 5 条
- events 取 topK → 最多 5 条
- **合计最多 10 条**

### 1.6 注入 cap

在 `assembleSystemPrompt()` (`apps/api/src/prompts/assemble.ts:24-28`):

```
[她记得]
- {pref[0].slice(0, 500)}
- {pref[1].slice(0, 500)}
... (最多 10 条 preference)
- {date} {event[0].text.slice(0, 500)}
... (最多 10 条 event)
```

- preferences: 最多 10 条,每条截断 500 字符
- events: 最多 10 条,每条截断 500 字符
- **注入总量上限: ~10,000 字符**(实际通常远小于此)
- 无明确硬 cap,由前端 topK=5 × 2 类 = 10 条控制

---

## 2. [用户画像] 完整链路

### 2.1 触发条件

位于 `apps/api/src/sidecar-ai/preference-recorder.ts`:

- 计数器: `inputCounters[userId]` 每次用户输入递增
- 触发: `inputCounters[userId] % 5 === 0` — **每 5 轮触发一次**
- 调用: `recordPreference()` 在 chat route 的步骤 5 前调用 (line 220)
- 计数器生命周期: 内存变量 `inputCounters`,进程重启后归零

### 2.2 输入素材

- `recentConversation`: 最近对话内容,截断到 **3000 字符**
- 送入 sidecar AI (preferenceRecorder prompt),要求输出结构化 JSON

### 2.3 输出 schema

`PreferenceRecordResult` (`packages/shared/src/types/sidecar.ts:38-43`):

```typescript
{
  preferences: string[];           // 用户偏好列表
  events: { date: string; text: string; emotion?: string }[];  // 事件列表
  relationshipState?: string;      // 关系状态(当前未注入 prompt)
  summary: string;                 // 用户画像 Markdown 摘要
}
```

### 2.4 存储位置

服务端 `store.state()` 三个位置:

1. **`userProfiles[userId].markdown`** — 累积的画像 Markdown
   - 格式: `## {ISO date}\n{summary}\n\n## {date}\n{summary}...`
   - 每 5 轮追加一条
2. **`userPreferences[id]`** — 偏好条目(带 id = `pref_{userId}_{timestamp}_{random}`)
3. **`userEvents[id]`** — 事件条目(带 id = `evt_{userId}_{timestamp}_{random}`)

注意: 2 和 3 与 [她记得] 通道**共享同一存储**,数据最终会通过 `/api/me/memories` 同步到前端 IndexedDB。

### 2.5 注入 cap

在 `chat.ts:232`:

```typescript
profile ? `[用户画像]\n${profile.slice(0, 500)}` : '',
```

- **硬截断: 500 字符**
- 注入位置: `sidecarBlock`(与温度提示、旧对话概要合并后附加到 system prompt)
- 不像 [她记得] 做召回——每次直接灌入最近一次画像全文(截断到 500)

---

## 3. 对照表

| 维度 | [她记得] | [用户画像] |
|---|---|---|
| **数据源** | preferenceRecorder 输出的 preferences[] + events[](服务端生成,同步到前端 IndexedDB) | preferenceRecorder 输出的 summary Markdown(同一 AI,同一触发) |
| **更新触发** | 被动同步——前端每 30s + 每轮完成后从服务端拉取增量 | 主动生成——服务端每 5 轮调用一次 preferenceRecorder |
| **存储** | 服务端 `userPreferences` / `userEvents`(truth) → 前端 IndexedDB Dexie(cache) | 服务端 `userProfiles[userId].markdown`(仅服务端,不同步到前端) |
| **召回方式** | **关键词匹配**(scoreText),每次用户输入触发,取 top-5×2 | **无召回**——直接取最近一次画像全文 |
| **内容粒度** | 单条偏好/事件原文,每条 ≤500 字符,最多 10 条 | 累积 Markdown 摘要(每轮一段 `## date\nsummary`),截断至 500 字符 |
| **注入字数上限** | ~10,000 字符(实际由 topK 控制) | 500 字符(硬截断) |
| **时效性** | 增量同步,近实时 | 依赖服务端内存计数器(进程重启归零),可能丢触发 |
| **上下文感知** | 关键词匹配——相关性强但粗糙 | LLM 合成——语义理解好但总量被压缩 |
| **累积方式** | 追加新条目,旧条目保留 | 追加新摘要段,旧段保留 |

### 3.1 重叠点(具体例子)

1. **同一 AI、同一触发、同一输出**: preferenceRecorder 每 5 轮跑一次,同时输出 `preferences[]`、`events[]` 和 `summary`。preferences/events 进入 [她记得] 通道,summary 进入 [用户画像] 通道——**同一份输出拆成两条路**。

2. **共享存储层**: preferenceRecorder 写入 `userPreferences` 和 `userEvents` 后,`/api/me/memories` 的 GET 接口直接读取这两个 store 返回给前端。前端 syncDown 拉取后存入 IndexedDB,供 recall 使用。即:画像生成器写入 → 记忆 API 读取 → 前端缓存 → recall 注入。**两条通道最终注入到同一个 system prompt**(chat.ts:276: `const system = [systemBase, sidecarBlock].join('\n\n')` 其中 systemBase 含 [她记得],sidecarBlock 含 [用户画像])。

3. **内容重叠实例**: 假设用户说"别叫我小可爱"。preferenceRecorder 会输出:
   - `preferences: ["用户不喜欢被叫'小可爱'"]` → 进入 [她记得],按关键词召回
   - `summary: "## 2026-05-21\n用户偏好: 对称呼敏感,排斥'小可爱'等亲昵称谓..."` → 进入 [用户画像],直接注入
   - **同一个事实在 prompt 里可能出现两次**。

4. **counter 共享但各自脆弱**: preferenceRecorder 的 `inputCounters` 是内存变量(进程重启归零),导致两个通道都依赖同一个不可靠计数器来获取新数据。

### 3.2 各自独有的能力

**[她记得] 独有:**

| 能力 | 说明 |
|---|---|
| 关键词召回 | 根据当前用户输入做相关性过滤,只注入相关的记忆 |
| 权重机制 | preferences 有 weight 字段,可调优先级 |
| 离线可用 | IndexedDB 在浏览器侧,即使服务端不可达也有缓存数据 |
| IF 线支持 | mode 字段支持 main / if 分线,IF 模式合并 main+if |
| 双向同步 | 前端可直接写入 dirty 行,上行到服务端 |

**[用户画像] 独有:**

| 能力 | 说明 |
|---|---|
| LLM 语义合成 | 将分散的偏好/事件合成为一段流畅的中文 Markdown 摘要 |
| 关系档案 | 累积的 `summary` 形成按日期组织的"关系发展史" |
| 紧凑注入 | 500 字符硬 cap,不随记忆条目增长而膨胀 |
| 独立于前端 | 纯服务端运行,不依赖浏览器 IndexedDB / 同步链路 |
| relationshipState | 输出 schema 有该字段(当前未注入 prompt,但可扩展) |

---

## 4. 候选方案

### 方案 A: 留 [她记得],弃画像

**操作:**
- 删除 `getUserProfile()` 调用和 sidecarBlock 中的 `[用户画像]` 注入(chats.ts:232)
- 保留 preferenceRecorder 的 preferences/events 生成(继续喂 [她记得])
- 可保留 summary 生成但不注入(存起来给未来的分析面板用)

**收益:**
- 消除 prompt 中的重复信息
- 简化 system prompt 装配逻辑
- [她记得] 的关键词召回比画像的"全文灌入"更精准

**代价:**
- 失去 LLM 合成的"关系档案"叙事——[她记得] 只有碎片化的偏好/事件条目,缺少上下文连贯性
- 500 字符的紧凑摘要消失,峰值时注入量可能增加到 ~3,000-5,000 字符(取决于 topK 命中率)
- 新用户/冷启动时没有画像可注入(recall 返回空)

### 方案 B: 留 [用户画像],弃她记得

**操作:**
- 移除前端 recall() 调用(useChat.ts:54)
- ChatRequest.recall 字段置空
- assembleSystemPrompt 中 `{{recall_block}}` 替换为空串
- 保留/优化 preferenceRecorder 的 summary 质量

**收益:**
- 大幅简化前端代码(去掉 Dexie、sync、recall 约 500 行)
- 单一注入源,prompt 结构清晰
- LLM 合成摘要质量高于关键词碎片

**代价:**
- 丢掉关键词召回的相关性过滤——画像永远是"全文灌入",与当前话题可能无关
- 500 字符硬 cap,无法承载大量记忆
- 丢掉离线能力和 IF 线支持
- 丢掉前端可直接写入记忆的能力(双向同步)

### 方案 C: 并存但明确分工

**操作(示例分工,待 PM 裁定):**
- [她记得] = **偏好/事件库**: 保留关键词召回,只注入与当前消息相关的具体偏好/事件条目
- [用户画像] = **关系档案/称呼**: 改 prompt 让 preferenceRecorder 只输出"称呼习惯 + 关系状态 + 对话风格",不做偏好列表

**实现变更:**
- 修改 preferenceRecorder prompt,让 summary 聚焦"关系档案"维度,不与 preferences[] 重复
- 或者:从 sidecarBlock 中移除 `profile`,让 [用户画像] 只写入 state 供未来分析面板使用,不注入主 prompt
- [她记得] 保持现状

**收益:**
- 两条通道各司其职,不再重复
- 保留关键词召回的精准性 + LLM 合成的关系叙事

**代价:**
- 改动最大——需要重写 preferenceRecorder prompt + 验证输出质量
- 两条链路维护成本持续存在
- 最终注入字数可能增加(两段加起来)

---

## 附录: 代码位置索引

| 文件 | 涉及 |
|---|---|
| `apps/web/src/memory/db.ts` | [她记得] Dexie schema |
| `apps/web/src/memory/recall.ts` | [她记得] 关键词召回 |
| `apps/web/src/memory/sync.ts` | [她记得] 双向同步 |
| `apps/web/src/hooks/useChat.ts:54` | [她记得] recall 调用点 |
| `apps/api/src/sidecar-ai/preference-recorder.ts` | [用户画像] 生成 + counter |
| `apps/api/src/sidecar-ai/prompts.ts:7` | preferenceRecorder prompt 模板 |
| `apps/api/src/routes/chat.ts:219-276` | 两条通道注入 system prompt |
| `apps/api/src/prompts/assemble.ts:24-28` | [她记得] 注入模板 |
| `apps/api/src/services/memories.ts` | 服务端记忆 CRUD |
| `apps/api/src/routes/me/memories.ts` | /api/me/memories 路由 |
| `packages/shared/src/types/sidecar.ts` | PreferenceRecordResult schema |
| `packages/shared/src/types/recall.ts` | RecallPayload schema |
