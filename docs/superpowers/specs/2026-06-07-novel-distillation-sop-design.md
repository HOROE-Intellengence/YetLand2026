# 设计：小说/人物蒸馏 SOP（人工操作手册 · 收口于 S4）

- 日期：2026-06-07
- 分支：codex/preference-consolidation
- 状态：S4 SOP 已定义；S5 角色包粘贴导入已落地

## 问题

要做"从小说蒸馏角色/世界观"的体系（三档模式，①②本期、③占位）。直接上自动管线，最烧工的部分（异步 job、进度、分块编排）会先吃掉精力，而抽取质量与 prompt 还没被验证过。

因此先不写代码：把蒸馏的"配方"做成一份**人工操作手册（SOP）**，用大上下文模型把流程手动跑通、验证抽取质量，再谈机械化。

## 目标

产出一份可重复执行的人工 SOP，核心交付三样：**一串按顺序的 prompt + 一套校验/质检标准 + 一个装配步骤**。SOP 跑完得到一份"校验过、装配好、瞄准角色卡 schema"的 JSON 产物。

## 非目标（本期不做）

- **不实现任何代码**：无 job、无进度、无分块代码、无前端。
- **S5 落库已由后台粘贴导入承接**：SOP 仍收口在 S4（产出 JSON），落库由后台角色卡“导入角色包”入口处理。
- **第③档（用户旁观 / 书本 if 线）不涉及**：那是另一套叙事引擎，单独立项。
- 不做 map-reduce 人工编排为主路径（仅作长文本 fallback）。

## 锁定决策

1. **形态 = 人工操作手册**，先跑通验证，不写基础设施。
2. **粒度 = 操作者按需选**：单角色路径 / 整本书路径，两条并存。
3. **长文本 = 大上下文一次过**为主路径；超出上下文时降级为"按卷/部分分次跑 + 合并"，配覆盖度自检兜底。
4. **档②用户角色 = 两者皆可**：书内取一个角色当用户角色，或外部带入用户自述。

## 角色

- **操作者（人）**：跑流程、做选择、把关质量、最后（未来）落库。
- **蒸馏 AI（大上下文模型，≥200k）**：执行每阶段 prompt。SOP 工具无关。
- **目标系统（夜阑）**：本期不参与；未来仅在 S5 接收成品 JSON。

## 管线总览与数据流

```
S0 摄入与定范围 ─┬─[单角色]→ 选定 1 目标 + 局部世界观骨架
                └─[整本书]→ 角色清单 + 全局世界观骨架 + 关系网骨架
      │
S1 角色卡抽取   → 每个目标角色：性格/说话风格/禁用语/开场白/style_tags
      │           └（可选 refine：主推角色交互打磨 voice/禁用语）
      │
S2 世界观抽取   → profileSections[]（key/value/order）
      │
S3 档②扩展     → 仅档②：用户角色卡 + 关系 + 备忘录（书内取/外部带入两分支）
      │
S4 装配与自检   → 合成 card JSON + 校验清单 + 覆盖度自检
      │
S5 后台导入     → 粘贴 JSON → preview → commit → character.import 审计
```

**数据流约定**

- **原文用完即弃**：S0 之后不再向下传整本原文，只传结构化中间产物（角色清单、世界观骨架、引文证据）。与"别把小说原文存进 store"的约束一致。
- **证据留痕**：每个抽取字段尽量带 1 条原文引文（`evidence`），供 S4 人工核对，**S4 装配时剥离，不入库**。
- **分档差异只在 S3**：档①跳过 S3；档②插入 S3。其余阶段两档共用。
- **路径差异只在 S0/S1 循环次数**：单角色跑一遍 S1；整本书对每个目标角色循环 S1，世界观 S2 跑一次。

## 使用说明（操作者 Runbook）

### 一、准备

- 一个**大上下文模型**（≥200k，如 Claude）。
- 小说全文（纯文本）。
- 一个存产物的地方（每阶段把 AI 回的 JSON 存成文件，如 `s1-沈砚之.json`）。

### 二、定路径与档位

先做两个选择，决定跑哪些阶段：

- **粒度**：只要一个角色 → **单角色路径**；要一次抽多个角色 + 全局世界观 → **整本书路径**。
- **档位**：只要角色 + 世界观 → **档①**；还要用户角色 + 关系 + 备忘录 → **档②**。

### 三、按选择执行（阶段序列）

| 路径 × 档位 | 执行序列 |
|---|---|
| 档① · 单角色 | `S0-B → S1 →(可选 S1-refine)→ S2 → S4` |
| 档① · 整本书 | `S0-A →【对每个目标角色循环 S1(可选 refine)】→ S2 → S4` |
| 档② · 单角色 | `S0-B → S1 → S2 → S3-A 或 S3-B → S4` |
| 档② · 整本书 | `S0-A →【每角色 S1】→ S2 → S3-A 或 S3-B → S4` |

> S3 选哪个：用户角色取自书中 → **S3-A**；用户自己/外部带入 → **S3-B**。

### 四、每步操作要领

1. 从 [Prompt 模板](#prompt-模板) 复制对应阶段的 prompt。
2. 替换其中所有【】占位（目标角色名、粘贴原文/草稿/自述等）。
3. 整段喂给蒸馏 AI，要求**只输出 JSON**。
4. 把回来的 JSON 存成文件；带 `evidence` 的**先别删**，留到 S4 核对。
5. 进入下一阶段时，按模板要求把上一阶段产物粘进去。

### 五、校验与收尾（S4）

1. 跑 **S4-1 装配** prompt，把 S1/S2(/S3) 合成最终 `card` JSON，自动剥 `evidence`、补 `operatorFields`。
2. 对照 **S4-2 清单**逐条打勾；任一不过 → 回对应阶段重跑。
3. 跑 **S4-3 覆盖度自检**；有遗漏 → 回 **S1-refine** 补，再回 S4。
4. 通过后得到成品 JSON，存档；需要落库时进入后台角色卡面板，使用“导入角色包”。

### 六、长文本与常见问题

- **原文塞不下**：走[长文本 fallback](#长文本-fallback)——S0/S1/S2 按卷分次跑，S4-1 合并。
- **JSON 吐崩/夹解释**：回该阶段，强调"只输出 JSON，不要任何额外文字"重跑。
- **slug 怎么取**：角色名拼音小写连字符（如 沈砚之 → `shen-yan-zhi`），且不与现有角色重名。
- **boundaryDefault 拿不准**：让模型给 1–5 的建议 + 理由，操作者最终拍板。

## 抽取 Schema

### 关键约束发现

当前后端角色卡（`CharacterRow` / `AdminCharactersCreateSchema`）**无结构化 voice 字段**——yaml 里的 `voice.pace/formality` 在运行期未被
[`loadCharacterCard`](../../../apps/api/src/prompts/loader.ts) 读取（它只用 `description` + `profileSections` + `forbiddenPhrases`）。故**说话风格在 SOP 里落到两处**：揉进 `description` 散文 + 可选拆一条 `profileSections`。

### A. S4 最终产物（瞄准角色卡字段）

字段与长度上限照搬 [`AdminCharactersCreateSchema`](../../../packages/shared/src/contracts/admin.ts)：

```jsonc
{
  "card": {
    "name": "string (1–40)",
    "slug": "string (^[a-z0-9-]+$, 2–40, name 拼音派生)",
    "styleTags": ["string"],                 // 蒸馏
    "boundaryDefault": 1,                      // 1–5，蒸馏建议 + 操作者确认
    "openingFirstVisit": "string (≤200)",     // 蒸馏
    "openingReturnVisit": "string (≤200)",    // 蒸馏
    "forbiddenPhrases": ["string"],           // 蒸馏：该角色绝不会说的话
    "description": "string (≤2000)",          // 蒸馏：核心人设散文，含说话风格
    "profileSections": [                       // 蒸馏：世界观/设定 + 可选「说话风格」一条
      { "key": "string(≤40)", "value": "string(≤2000)", "order": 0 }
    ]
  },
  "operatorFields": { "rarity": "free", "priceCandle": 0 }   // 非蒸馏，操作者填，给默认
}
```

> 长度上限须写进 S1/S2 的 prompt，否则 S4 校验会挂。`rarity ∈ free|paid|hidden`，`boundaryDefault ∈ 1–5`。

### B. 档②扩展块（S3 产出，独立于 card）

不进角色卡，瞄准未来的 `userProfileFacts`/`userEvents`（见
[`preference-recorder`](../../../apps/api/src/sidecar-ai/preference-recorder.ts) 的 `relationship` / events 结构）：

```jsonc
{
  "userRole": { /* 同 card 形状精简版；书内取=完整蒸馏，外部带入=操作者自述整理 */ },
  "relationship": "string (≤500)",                                  // → 未来 type:'relationship'
  "memo": [ { "date": "string?", "text": "string", "emotion": "string?" } ]  // → 未来 userEvents
}
```

### C. 阶段中间产物（S0–S3，用完即弃）

```jsonc
// S0 整本书： { characters:[{name,role,salience}], worldviewSkeleton:[...], relationshipEdges:[{a,b,relation}] }
// S0 单角色： { target, enough, note, relevantWorldview:[...] }
// S1：每角色一份 card 草稿（A 的 card 形状，去 operatorFields）+ evidence
// S2：{ profileSections:[...], evidence:{...} }
// S3：B 的档②块
```

### D. 证据留痕约定

每阶段产物额外带 `evidence`（字段名→原文引文，1 条即可），供 S4 核对真伪；**S4 装配剥离**，不进最终产物。

## Prompt 模板

占位符统一用【】。措辞为最易迭代部分，可随时调。

### S0-A ｜整本书 · 选角与定范围

```
你是小说人物蒸馏助手。下面是一本小说全文。通读后只做"骨架"，不做角色卡。
输出：
1. characters：有实质戏份的角色，每个 {name, role(故事定位), salience(主角/重要配角/次要)}
2. worldviewSkeleton：5–12 条要点，覆盖时代/地点/核心设定/规则/基调，每条一句
3. relationshipEdges：关键角色两两关系 {a, b, relation(一句)}
只输出 JSON：{ "characters":[...], "worldviewSkeleton":[...], "relationshipEdges":[...] }

【粘贴小说全文】
```

### S0-B ｜单角色 · 定范围

```
你是小说人物蒸馏助手。目标角色：【目标角色名】。
通读下文后输出：
1. enough：该角色戏份是否够蒸馏（true/false）+ note 一句理由
2. relevantWorldview：只与该角色相关的世界观要点 5–10 条
只输出 JSON：{ "target":"【目标角色名】", "enough":true, "note":"…", "relevantWorldview":[...] }

【粘贴小说全文或相关片段】
```

### S1 ｜角色卡抽取（每个目标角色跑一遍）

```
你是角色卡蒸馏助手。基于下文，为【目标角色名】产出角色卡草稿。严守字段与长度上限，
每个关键字段附 1 条原文引文作证据。
字段规则：
- name(≤40)
- slug：name 拼音小写连字符，仅 a-z0-9-（2–40）
- styleTags：3–6 个英文小写标签（如 modern, restrained, push-pull）
- description(≤2000)：核心人设散文，必须含：性格内核 + 相处方式 + 【说话风格】(节奏/句长/惯用语/回避什么)
- forbiddenPhrases：该角色绝不会说的词/句，3–8 条
- openingFirstVisit(≤200)：以其口吻写"初次见面"开场白
- openingReturnVisit(≤200)：以其口吻写"再次到访"开场白
- boundaryDefault：1–5，估默认亲密/尺度基调(1最克制…5最直接)+一句理由
- profileSections：可选，把"说话风格"等可结构化细节各拆一条 {key(≤40),value(≤2000),order}
只输出 JSON：
{ "card":{ "name","slug","styleTags","description","forbiddenPhrases",
  "openingFirstVisit","openingReturnVisit","boundaryDefault","profileSections":[{"key","value","order"}] },
  "evidence":{ "description":"…","forbiddenPhrases":"…","boundaryDefault":"…" } }

目标角色：【目标角色名】
【粘贴小说全文】
```

### S1-refine ｜可选，主推角色交互打磨

```
这是刚产出的角色卡草稿：【粘贴 S1 的 card JSON】。
只改我点名的部分，其余不动，改完回完整 card JSON：
- 说话风格：【如"更冷、短句再短"】
- forbiddenPhrases：【增/删】
- 开场白：【语气调整】
```

### S2 ｜世界观抽取

```
你是世界观蒸馏助手。基于下文抽取世界观/设定，输出为角色卡的 profileSections。
每条 {key(设定名≤40), value(说明≤2000), order(从0递增)}；覆盖时代/地点、社会规则、
关键设定项、基调氛围；8–15 条为宜；每条附 1 条原文引文。
只输出 JSON：{ "profileSections":[{"key","value","order"}], "evidence":{ "<key>":"…" } }

【粘贴小说全文】
```

### S3-A ｜档② · 用户角色取自书中

```
档②扩展（用户角色取自书中）。目标角色：【已蒸馏角色名】；用户角色：【书中另一角色名】。
基于全文输出：
1. userRole：为【用户角色名】产精简角色卡（同 S1 字段，description 可短）
2. relationship(≤500)：二者在书中的关系
3. memo：3–8 条关键事件/约定/转折，每条 {date(可空),text,emotion(可空)}
只输出 JSON：{ "userRole":{...}, "relationship":"…", "memo":[{"date","text","emotion"}] }

【粘贴小说全文】
```

### S3-B ｜档② · 用户角色外部带入

```
档②扩展（用户角色由用户自述带入）。目标角色：【已蒸馏角色名】。用户自述：【粘贴自述】。
基于全文+自述输出：
1. userRole：把自述整理成精简角色卡（同 S1 字段）
2. relationship(≤500)：设定二者合理的初始关系，须贴合目标角色性格
3. memo：2–5 条可作共同记忆起点的条目 {date(可空),text,emotion(可空)}
只输出 JSON：{ "userRole":{...}, "relationship":"…", "memo":[{"date","text","emotion"}] }

【粘贴小说全文】
【粘贴用户自述】
```

### S4-1 ｜装配 prompt

```
把以下片段合成最终角色卡 JSON。剥掉所有 evidence；补 operatorFields。
强制满足：slug 合法；各字段不超长；profileSections.order 从 0 连续；JSON 合法。
有缺失/超长先修正再输出。
S1 card：【粘贴】
S2 profileSections：【粘贴】
(仅档②) S3 block：【粘贴】
operatorFields：{ "rarity":"free", "priceCandle":0 }
只输出：{ "card":{...}, "operatorFields":{...} (, "tier2":{...}) }
```

### S4-2 ｜人工校验清单（逐条打勾）

- [ ] JSON 能 parse
- [ ] slug 符合 `^[a-z0-9-]+$`、2–40、不与现有角色重名
- [ ] 长度未超限（description/value≤2000、key≤40、opening≤200）
- [ ] boundaryDefault ∈ 1–5
- [ ] description 确实含说话风格
- [ ] 抽查 2 条 forbiddenPhrases，回原文确认确实不符其口吻
- [ ] profileSections.order 从 0 连续

### S4-3 ｜覆盖度自检（长文本安全网）

```
你之前基于全文产出了这张角色卡：【粘贴最终 card】。
回原文检查是否遗漏该角色重要侧面（关键转折/反差面/标志性台词）。
列出"卡里没体现但原文重要"的点（≤5 条）；若无，回"无遗漏"。
```

> 有遗漏 → 回 S1-refine 补。

### 长文本 fallback

若全文超出上下文：S0/S1/S2 改为按"卷/部分"分次跑，S4-1 装配时合并多次产物；S4-3 覆盖度自检照常，作为漏检兜底。

## 未来机械化对照（备忘，不在本期）

当 SOP 验证通过、转自动管线时，各阶段映射如下：

- **抽取调用**：走 [`packages/llm`](../../../packages/llm) 主模型 router，**不要**走 sidecar（侧袋为"快/小/3–8s 超时"调优，与蒸馏的"大/慢/多次"相反）。
- **schema 校验/容错归一**：照搬 [`output-structurer`](../../../apps/api/src/sidecar-ai/output-structurer.ts) 的 coerce→normalize→safeParse→降级范式（这部分可复用）。
- **分块**：自写；`token-guard` 是预算闸不是分块器，仅可复用其成本封顶。
- **落库**：后台 `POST /api/admin/characters/import/preview` 预览，`POST /api/admin/characters/import` 提交；最终走 `charactersService.upsert`（[characters.ts](../../../apps/api/src/services/characters.ts)）并落 `character.import` 审计。

## 验收

- 用一本真实小说，按单角色路径 + 整本书路径各跑一遍 S0→S4，产出能 parse、过 S4-2 清单的 card JSON。
- 档② 跑通 S3-A 与 S3-B，产出含 userRole/relationship/memo 的块。
- 覆盖度自检能发现至少一处可补充项（验证安全网有效）。
