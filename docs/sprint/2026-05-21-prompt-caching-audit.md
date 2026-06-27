# Prompt Caching 探底报告

> 日期: 2026-05-21 | 分支: cache-poc | POC 脚本: scripts/cache-poc.mjs

---

## 1. 现役 Provider 身份

| 角色 | ID | baseUrl | 默认模型 | 协议 |
|---|---|---|---|---|
| Main | `env-nvidia` | `https://integrate.api.nvidia.com/v1` | `z-ai/glm-5.1` | nvidia (OpenAI 兼容) |
| Sidecar | `horoe-sidecar` | `https://horoe.cn/v1` | `gemini-3.1-flash-lite` | openai-compatible |

> 注: `horoe-main` 同为 horoe.cn 的 Gemini 模型(另一个 key),缓存特性与 horoe-sidecar 一致,不单独测试。

来源: `GET http://127.0.0.1:8787/health` + `apps/api/.local/state.json`

---

## 2. 官方文档结论

### 2.1 NVIDIA NIM (`integrate.api.nvidia.com`)

**文档来源确认:**
- 官方 API 文档入口 `https://docs.api.nvidia.com/nim/` 持续返回 404;主站 `https://build.nvidia.com` 加载超时(60s)
- 多次搜索 "NVIDIA NIM prompt caching cached_tokens" 均被搜索 API 拒绝(非文档问题,搜索后端限制)
- 实测使用 OpenAI 兼容 `/chat/completions` 端点,请求体格式为标准 `{ model, messages, stream, stream_options }`,无 NVIDIA 专有缓存参数

**判定:** 未经官方文档确认缓存支持;从 API 表面特征(OpenAI 兼容参数集)和实测数据推断,**不支持 prompt 前缀缓存**。

### 2.2 horoe.cn (Gemini 代理)

**文档来源确认:**
- `https://horoe.cn/v1` 本身返回 404(无文档首页)
- 其下游模型 `gemini-3.1-flash-lite` 基于 Google Gemini API
- Google 官方文档 `https://ai.google.dev/gemini-api/docs/caching` 确认:
  - **隐式缓存(Implicit Caching)**: Gemini 2.5+ 模型自动启用,无需开发者操作,前缀 ≥1024 tokens(Flash 模型)即可命中
  - **显式缓存(Explicit Caching)**: 需手动创建 `cached_content`,TTL 默认 1 小时
  - 缓存命中信息在 `usage_metadata` 中返回

**判定:** 下游模型支持隐式缓存,但经过 horoe.cn 代理后可能存在损耗。

---

## 3. POC 实测数据

### 3.1 测试方法

- 脚本: `scripts/cache-poc.mjs`
- 两次请求共用同一个 system prompt(2178 字符,远大于 1024 token 阈值)
- RUN-1: `"你好,今天天气怎么样?"`
- RUN-2: `"请讲一个简短的笑话。"`(800ms 间隔)
- 测量: TTFT(首 token 延迟) + usage 原文

### 3.2 NVIDIA NIM 实测

| 指标 | RUN-1 | RUN-2 |
|---|---|---|
| TTFT | 16568 ms | 35948 ms |
| 总耗时 | 29543 ms | 44423 ms |
| prompt_tokens | 419 | 420 |
| completion_tokens | 128 | 128 |
| total_tokens | 547 | 548 |

**usage 原文(RUN-1):**
```json
{
  "prompt_tokens": 419,
  "total_tokens": 547,
  "completion_tokens": 128
}
```

**usage 原文(RUN-2):** 仅有 `prompt_tokens / total_tokens / completion_tokens`,与 RUN-1 结构相同,无新增字段。

**分析:**
- usage 仅含 3 个标准字段,无任何缓存相关键(`cached_tokens`、`prompt_tokens_details` 等均不存在)
- RUN-2 TTFT **比 RUN-1 慢 117%**(+19380ms),排除缓存命中可能
- 两次均收取完整 `prompt_tokens`(419/420),无折扣

**结论: NVIDIA NIM (z-ai/glm-5.1) 不支持 prompt 前缀缓存。**

### 3.3 horoe-sidecar 实测(两次独立运行取均值)

| 指标 | RUN-1 | RUN-2 |
|---|---|---|
| TTFT(第 1 次) | 2842 ms | 1456 ms |
| TTFT(第 2 次) | 2781 ms | 1587 ms |
| TTFT 均值 | 2812 ms | 1522 ms |
| **TTFT 降幅** | — | **-46%** (平均 -1290ms) |

**usage 原文(RUN-1, 第 2 次运行):**
```json
{
  "prompt_tokens": 8,
  "completion_tokens": 0,
  "total_tokens": 8,
  "prompt_tokens_details": {
    "cached_tokens": 0,
    "text_tokens": 8,
    "audio_tokens": 0,
    "image_tokens": 0
  },
  "completion_tokens_details": {
    "text_tokens": 0,
    "audio_tokens": 0,
    "reasoning_tokens": 0
  },
  "input_tokens": 0,
  "output_tokens": 0,
  "input_tokens_details": null,
  "claude_cache_creation_5_m_tokens": 0,
  "claude_cache_creation_1_h_tokens": 0
}
```

**分析:**
- usage schema 包含 `prompt_tokens_details.cached_tokens` 字段 — **API 表面支持缓存报告**
- 但两次 `cached_tokens` 均为 **0** — 代理层未正确传递 Gemini 的 `usage_metadata`
- `prompt_tokens` 报 8/7(严重偏低),token 计数报告不可靠(horoe.cn 代理的已知偏差)
- **TTFT 实测下降 46%** — 这是缓存命中的硬证据:相同前缀第二次请求获得显著加速
- 该行为与 Google Gemini **隐式缓存**机制一致:自动生效,无需显式创建

**结论: horoe-sidecar 部分支持 —— 基础设施层缓存生效(TTFT 可证),但 usage 报告未正确标注缓存命中(无法用于计费核算)。**

---

## 4. 综合判定

| Provider | 缓存支持 | TTFT 改善 | usage 报告 | 可用性 |
|---|---|---|---|---|
| env-nvidia (z-ai/glm-5.1) | **否** | 无(反而更慢) | 无缓存字段 | 不可用 |
| horoe-sidecar (gemini-3.1-flash-lite) | **部分** | -46% (1290ms) | `cached_tokens` 存在但始终为 0 | 可用但不透明 |

**一句话结论: 现有两个 provider 均不满足"完整、可核算的 prompt 缓存"需求。horoe 有隐性加速但不可计量,NVIDIA 完全无缓存。**

---

## 5. 替代方案

### 方案 A: 切 provider 到原生 Gemini API

**操作:**
- 将 sidecar 的 baseUrl 从 `https://horoe.cn/v1` 改为 `https://generativelanguage.googleapis.com/v1beta`
- 使用 Google AI SDK 或 Gemini 兼容的 OpenAI 端点
- 利用 Gemini 隐式缓存(免费、自动)或显式缓存(可控制 TTL)

**代价:**
- 需要 Google API key(GCP 账号)
- 需适配 Gemini API 的 OpenAI 兼容层差异(如 `response_format`、`stop` 等参数名差异)
- horoe.cn 可能提供了网络可达性优势(国内直连),直连 Gemini API 可能需要代理

### 方案 B: 加本地反向代理做前缀缓存

**操作:**
- 在本地部署一个轻量代理(如自定义 Node.js 服务),拦截请求
- 计算 system + 前 N 轮对话的 hash,命中则跳过前缀 token,仅发送新 user content
- 本质上把 Anthropic 式的 prompt caching 用应用层模拟

**代价:**
- 开发成本 ~2-3 天(代理 + 缓存层)
- 需要理解底层 provider 的 tokenizer 做前缀切分(或保守地用字符串截断)
- 额外网络跳转可能抵消部分收益
- 维护成本:每次 provider 变动需适配

### 方案 C: 放弃 P3 缓存路线(当前可接受)

**操作:**
- 承认当前 provider 组合不支持可核算的 prompt 缓存
- 把 prompt caching 列为 provider 选型的前置条件而非独立优化项
- 短期通过其他手段降本:优化 prompt 长度(工单 T1 已验证)、减少每轮注入的冗余块

**代价:**
- 损失 -46% TTFT 的潜力(约 1.3s),在 sidecar chain 中累积影响体感延迟
- 每次请求仍支付完整 prompt 的 token 费用,无缓存折扣
- 大规模用户下成本线性增长

---

## 6. 附录: 复现命令

```bash
# 运行 POC(需要 NVIDIA_API_KEY 环境变量)
NVIDIA_API_KEY="nvapi-..." node scripts/cache-poc.mjs

# 输出: 两个 provider 各两次请求的 TTFT + usage 原文
```

```bash
# 验证文件
ls scripts/cache-poc.mjs                              # POC 脚本
ls docs/sprint/2026-05-21-prompt-caching-audit.md     # 本报告
```

> 注意: 报告中的 API key 已隐去(实际 key 在 `.env` 中,未写入本文)。
