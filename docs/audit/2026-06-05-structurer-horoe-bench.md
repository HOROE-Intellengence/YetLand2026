# 分句侧袋（output-structurer）真实端点实测与耗时/可靠性分析

- 日期：2026-06-05
- 端点：`horoe-sidecar` = `gemini-3.1-flash-lite` @ `https://horoe.cn/v1`（openai-compatible，第三方 Gemini 代理）
- 被测改动：分句侧袋的三处修复（`maxTokens` 选项 + 逐句 `coerce` 容错 + 删除静默模型回退），均为当前**工作区未提交改动**（`git status` 显示 Modified），落在 `apps/api/src/sidecar-ai/client.ts`、`apps/api/src/sidecar-ai/output-structurer.ts`、`apps/api/src/services/llm-api-inventory.ts`
- 脚本：[`scripts/bench-structurer-horoe.mjs`](../../scripts/bench-structurer-horoe.mjs)
- 原始数据：`scripts/.bench-horoe-main.json`（实长 90 轮）、`scripts/.bench-horoe-xlong.json`（超长截断专项 20 轮）。**API key 全程仅从 `apps/api/.local/state.json` 读入内存用于请求头，不入日志、不入库。**

---

## 0. 结论先行（TL;DR）

1. **真实 gemini-flash-lite 下，分句完全成功时的 total 分布**（实长样本短/中/长池化 88 轮）：**P50 ≈ 5.0s、P90 ≈ 6.4s、P99 ≈ 8.8s**。其中 **TTFT 占大头**（P50 ≈ 3.7s，约 total 的 74%），decode P50 仅 ≈ 1.1s。**超 8000ms 预算比例 ≈ 1%（1/88）**。
2. **"时而无效"在实长样本下主要由 timeout（卡顿/超预算）而非 parse/schema 造成**：实长 90 轮共 3 次降级 = 1 次 45s 卡死 + 1 次 8755ms 超预算（均归 timeout 类）+ 1 次模型吐空（parse）；**schema 降级 0 次**。历史上更大的"时而无效"来自两个已被本次改动消除的根因——静默回退到 glm-5.1（20–25s，必超时）和长回复在 1024 token 处被截断。
3. **max_tokens 1024→2048 对长回复截断的修复是决定性的**：构造一条 ~1124 字、结构化 JSON 自然约 1185 token 的超长回复——
   - **1024 上限：0/10 解析完整，10/10 降级，其中 7/10 为 `finish_reason=length` 截断**（JSON 被腰斩 → 解析失败）。
   - **2048 上限：10/10 解析完整**（outTok=1185 自然收尾），8/10 完全 OK（余 2 发因超长 decode 使 total≈9.0s 超 8000ms，属预算问题而非截断）。
   - 即同一条超长回复，截断率 70%→0%、整体降级 100%→0%（解析层面）。
4. **`coerce` 在本次 112 轮全样本中救回 0 轮**。原因：gemini-flash-lite 不被截断时吐的 type/text 很干净，几乎不产生"坏 type/缺 text"；且 **coerce 救不了截断**——截断的 JSON 在 `JSON.parse` 阶段就整体失败，根本到不了 coerce。结论：coerce 是防御性保险（针对偶发坏 type 的模型/换模型场景），不是本模型当前的高频救星；治长回复降级的是 max_tokens，不是 coerce。
5. **残留降级几乎全部来自 horoe.cn 自身**：实长 90 轮里 1 次 45s 上游卡死 + 1 次模型吐空 ≈ **2% 基线不稳定**，约束/截断/容错都治不了。**据此，"侧袋加退避重试"值得做**（见 §6）——一次轻量重试可吃掉这 ~2% 的瞬时卡顿/空响应，但须配节流，避免重蹈本次首跑的级联（见 §7）。

---

## 1. 方法学

- **打真实端点**：脚本从 `state.json` 的 `sidecarApiId` 条目读 `baseUrl/model/apiKey`，直接打 `horoe-sidecar`。**不复用** `scripts/bench-structurer.mjs`（那打的是 NVIDIA NIM/glm-5.1，错端点，20–25s 是排队伪影，不代表 gemini-flash-lite）。
- **请求体对齐 `client.ts`**：`temperature:0.3`、`response_format:{type:'json_object'}`、`max_tokens` 走被测变量。为拆 TTFT/decode 额外开 `stream:true` + `stream_options.include_usage`。
  - ⚠️ **生产链路是非流式的**（`client.ts` 用 `res.json()` 一次读全），TTFT 在生产**不可兑现**；判定成败的是 **total 墙钟 vs 8000ms**。本报告里 TTFT/decode 仅用于拆解延时来源。
- **提示词用真实的**：脚本从 `apps/api/src/sidecar-ai/prompts.ts` 原样正则抽取 `outputStructurer`（559 字），不自编。
- **解析复用线上逻辑**：照搬 `extractSidecarJson`（去 think / 拆围栏 / 截首尾括号）+ `normalizeStructurerParts` + `coerceStructurerParts`，并以 `OutputStructurerResultSchema` 的反事实严格校验度量"coerce 救回"。"完整/降级"判定与线上一致。
- **预算口径**（均读自源码，非假设）：
  - `OUTPUT_STRUCTURER_TIMEOUT_MS = 8000`（`output-structurer.ts:10`，即 `sidecarCall` 的 abort）
  - `STRUCTURER_BUDGET_MS = 8000 + 500 = 8500`（`chat.ts:38`，`Promise.race`）
  - `sidecarCall` 自身 8000ms abort 先触发，故**有效天花板 = 8000ms**；脚本把 total ≥ 8000ms 的"本可完成但超预算"轮次记为 timeout 降级。
- **样本四档**（台词/动作括号/环境/旁白混合的真实回复形态）：短 60 字、中 157 字、长 751 字、超长 1124 字（最后一档专为触发 1024 截断而造）。
- **节流与计量**：每发间隔 2.5s，单发上限 45s；出错后冷却 10s；仅对"连接级 `fetch failed`"退避重试（最多 3 次），真正的超时计入降级不重试。每档先 1 发 warmup（不计），实长档各 15 轮、超长档各 10 轮，串行不并发。每轮记录 ttft/decode/total/completion_tokens/finish_reason/是否完整/降级原因。

---

## 2. 主表：输入长度 × max_tokens

实长三档各 15 轮、超长档各 10 轮。`完整率` = `JSON.parse`→coerce 后 parts>0 的轮次；`OK率(含预算)` = 完整 **且** total<8000ms。延时 P50/P90/P99/max 单位 ms，只统计解析完整的轮次。

| 组 | 完整率 | OK率(含预算) | timeout | parse | schema | http/net | 截断(len) | coerce救回 | total P50 | P90 | P99 | max | TTFT P50 | decode P50 | outTok中位 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| short×1024 | 14/15 | 14/15 | 1 | 0 | 0 | 0 | 0 | 0 | 4945 | 5894 | 6280 | 6280 | 4359 | 286 | 120 |
| short×2048 | 15/15 | 15/15 | 0 | 0 | 0 | 0 | 0 | 0 | 4692 | 5767 | 6267 | 6267 | 3986 | 250 | 120 |
| mid×1024 | 15/15 | 14/15 | 1 | 0 | 0 | 0 | 0 | 0 | 4561 | 7503 | 8755 | 8755 | 3383 | 1181 | 298 |
| mid×2048 | 15/15 | 15/15 | 0 | 0 | 0 | 0 | 0 | 0 | 4756 | 5585 | 7406 | 7406 | 3589 | 881 | 298 |
| long×1024 | 15/15 | 15/15 | 0 | 0 | 0 | 0 | 0 | 0 | 5517 | 6102 | 7631 | 7631 | 3316 | 1850 | 833 |
| long×2048 | 14/15 | 14/15 | 0 | 1 | 0 | 0 | 0 | 0 | 6234 | 6585 | 6974 | 6974 | 3918 | 2097 | 833 |
| **xlong×1024** | **0/10** | **0/10** | 0 | **10** | 0 | 0 | **7** | 0 | — | — | — | (7409) | — | — | ~1008(截) |
| **xlong×2048** | **10/10** | **8/10** | 2 | 0 | 0 | 0 | 0 | 0 | 7360 | 9012 | 9055 | 9055 | 3723 | 3344 | 1185 |

**池化（实长三档 88 个解析完整轮次）**：total P50=4978 / P90=6370 / P99=8755 / max=8755；TTFT P50=3674 / P90=5076；decode P50=1140 / P90=2452。超 8000ms：1/88（1.1%）。

要点观察：
- **outTok 是延时主因之二（decode），但 TTFT 才是主因之一**：短回复 outTok≈120、decode≈0.3s；长回复 outTok≈833、decode≈1.9s；超长 outTok≈1185、decode≈3.3s。TTFT 则与长度几乎无关，稳定在 3–5s，是代理固有首字延时。
- **实长档 1024 vs 2048 延时无系统差异**：因为实长回复（≤833 token）在两个上限下都不截断，outTok 完全相同（120/298/833），延时差落在代理抖动范围内。**max_tokens 只在回复超过 1024 token 时才产生差异。**

---

## 3. max_tokens 1024→2048：截断对照（核心验证）

实长样本（≤833 token）无法触发 1024 截断——751 字的"长回复"实测仅 833 completion token，1024 从不是约束。要验证改动必须用 **超长回复**（结构化 JSON 自然 >1024 token）。

构造 1124 字超长回复（自然约 1185 token），同一输入跑两个上限各 10 轮：

| 上限 | 解析完整 | finish=length 截断 | 整体降级 | outTok |
|---|---|---|---|---|
| **1024** | **0/10** | **7/10** | **10/10**（全 parse 失败） | 截在 ~1007–1008 |
| **2048** | **10/10** | 0/10 | 2/10（均为 total≈9.0s 超预算，非截断） | 1185（自然收尾） |

- **截断率：1024 下 70%（finish=length），2048 下 0%**。另 3/10 的 1024 轮虽 finish=stop 但 outTok 偏低（662/801/827）且 parts=0——是 horoe 偶发的早停/吐残，叠加在截断之上，使 1024 的**整体降级达 100%**。
- **2048 把这条超长回复从"必降级"救成"必解析完整"**。代价是超长回复的 decode 升到 ~3.3s，叠加 ~5s TTFT 后，**20% 的轮次 total 摸到 9.0s 越过 8000ms 预算**——说明对极长回复，瓶颈已从"截断"（已修）转移到"8s 预算"（见 §5）。

**结论**：max_tokens 改动对长回复**实质性、决定性地**降低了降级率——把超 1024 token 回复的截断降级从 ~100% 砍到 0。这是三处改动里收益最确凿的一项。

---

## 4. coerce 容错：实测救回 0 轮，但定位要厘清

112 轮全样本中 **coerce 救回 0 轮**。两个事实解释它：

1. **本模型不吐坏 type**：gemini-flash-lite 在不被截断时，输出的 `type` 全是合法四选一、`text` 均非空。coerce 设计要救的"坏 type 归一 / 丢空文本句"在本模型当前几乎不出现。
2. **coerce 救不了截断**：截断的 JSON 是结构性残缺，`JSON.parse(extractSidecarJson(...))` 在解析阶段就整体抛错，**数据根本到不了 coerce**。所以长回复降级只能靠 max_tokens 预防，coerce 无能为力。

因此 coerce 的价值是**防御性保险**：
- 对冲未来换用"爱吐 `speech`/`talk` 等非法 type"的模型，或单句缺 text 的情形——届时它能把"一个坏 part 整段降级"变成"丢一句、留其余"。
- 当前 horoe/gemini 组合下它不是高频救星，**不应据此评估它"有没有用"**；它和 max_tokens 治的是不同病。

---

## 5. 预算撑不撑得住

- **实长回复（短/中/长，覆盖绝大多数真实对话）**：池化 P90=6.4s、P99=8.8s，**超 8000ms 仅 1.1%（1/88）**。在 8000ms abort + 8500ms race 预算下，实长分句**绝大多数撑得住**，偶发越界来自 horoe 抖动而非长度。
- **超长回复（>1100 字 / >1024 token）**：即便 max_tokens=2048 解决了截断，decode 升到 ~3.3s 使 **20% 轮次 total≈9.0s 越过 8000ms**。这类极长回复是当前预算的真实压力点——但属低频长尾，且越界后走 `fallbackStructure` 正则兜底，体验退化可接受。
- TTFT（3–5s）是延时基底，且生产非流式无法靠"早出字"规避——这是 horoe 代理的固有成本，非本次改动可改善。

**"时而无效"归因**：在已删除静默回退（不再落 glm-5.1 的 20–25s）、已放宽 max_tokens（不再截断长回复）之后，实长场景的残余降级以 **timeout（代理卡顿/超长越预算）** 为主，**parse 偶发（模型吐空）**次之，**schema 基本为 0**。

---

## 6. 残留 horoe 卡顿 & 是否值得加退避重试

约束收口、截断放宽、逐句容错都治不了的那部分，全是 **horoe.cn 自身**：

- 实长 90 轮：1 次 45s 上游卡死（abort）+ 1 次模型吐空（outTok=0 → parse 失败）= **~2.2% 基线不稳定**。
- 超长 10 轮（2048）：另有 2 次因长度越 8s 预算（这部分是预算问题，重试也救不了，反而更慢）。
- horoe 已知毛病实测确认：(a) `prompt_tokens` 报数不可信（本报告全程只用 `completion_tokens`）；(b) 偶发上游空闲卡顿（本次抓到 1 次 45s 卡死，以及首跑的级联，见 §7）。

**建议：侧袋值得加"一次性轻量退避重试"，但要克制且配节流。**
- **值得**：~2% 的卡顿/空响应是瞬时的，单次重试（间隔几百 ms）大概率落到一个正常响应上，能把分句完整率再抬约 2 个百分点，成本极低。
- **边界**：
  - 只对**连接级失败 / 明确空响应 / 早停 parse 失败**重试；**不对"已 8s 超预算"重试**（那只会更慢，应直接走兜底）。
  - 重试**必须在 8500ms race 预算内**完成，否则主链路已用 `fallbackStructure` 兜底、重试结果会被丢弃（`chat.ts` 已有"budget discard"日志）。实际上 8s 预算几乎不给第二次重试留空间——**所以更现实的做法是把重试放在"赛跑预算之外的后台补算"**，或仅在首发**快速失败**（连接级 fetch failed，通常 <1s）时立刻重试一次。
  - **务必节流**：本次首跑的级联事故（§7）证明，对 horoe 零间隔猛打会触发连接级封锁。任何重试都要带最小间隔/抖动。

---

## 7. 附录：首跑级联事故（一手教训）

首次跑（零间隔串行、单发上限 90s）在 `short×1024` 第 6 轮一发卡满 90s 后，**此后每一发都瞬时 `fetch failed`**，96 发里 85 发级联报废——这不是 429（限流返回体），而是 **TCP 连接级失败**：一发卡死把连接池打坏 + 零间隔猛打触发代理封连接。

加固后复跑（每发间隔 2.5s + `Connection: close` 强制新连接 + 出错冷却 10s + 仅对连接级失败退避重试）**级联完全消失**，96 发几乎全绿，只剩零星真·降级。

**可复用结论**：对 horoe.cn 这类第三方代理，客户端侧节流（间隔 + 短连接 + 错误冷却）是稳定性的硬前提；这一条直接约束了 §6 里"侧袋重试"的实现方式。

---

## 附：复现

```bash
# 实长三档 × max_tokens(1024/2048)，各 15 轮
node scripts/bench-structurer-horoe.mjs --rounds=15

# 超长截断专项，各 10 轮，独立结果文件
node scripts/bench-structurer-horoe.mjs --rounds=10 --lens=xlong --out=scripts/.bench-horoe-xlong.json
```

端点/密钥从 `apps/api/.local/state.json` 的 `sidecarApiId` 条目读取；若线上路径不同用 `YELAN_STATE_FILE=...` 指定。
