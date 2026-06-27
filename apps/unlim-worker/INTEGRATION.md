# 在夜阑中的角色

本 Worker 是夜阑 LLMRouter 的**主模型路径之一**（ADR-0002）。

```
apps/server (Hono / Workers)
    │
    ▼  llm/providers/nvidia-unlim.ts
    │  fetch ${UNLIM_WORKER_URL}/api/chat
    ▼
apps/unlim-worker (本项目)
    │
    ▼  调 NVIDIA NIM
```

## 与原 README 的差异

原 README 描述的是它作为独立项目的接口（`/health`、`/api/models`、`/api/chat`），那些接口**不变**。本文件只补充：

- 它在夜阑系统中的位置
- 部署 / 配置时与 `apps/server` 的关系
- 出问题时的影响范围

## 部署关系

- 独立 wrangler 项目，单独的 secrets（`NVIDIA_API_KEY`），独立的 routes。
- `apps/server` 的 `wrangler.toml` 写 `UNLIM_WORKER_URL` 指向它。
- 切换 NVIDIA 项目 / 替换为自部署模型时，只动本 Worker，主 server 无感。

## 本地开发例外（ADR-0006）

- `apps/api` 不通过本 Worker 调 NVIDIA —— 直接走 `https://integrate.api.nvidia.com`。
- 起因：Windows 下 `wrangler dev` 的 workerd 在 SSE 流结束时不发 TCP FIN，导致 Node `fetch` 永久 hang，进而占住 wrangler 单线程把整个 worker 拖死。
- 影响范围：仅本地开发体验。线上 Cloudflare Edge 不存在该问题。
- 代价：mock-server 复刻了一份 `DIRECT_RESPONSE_PROMPT` 与模型白名单 —— 修改时**两处同步**：
  - `apps/unlim-worker/src/config.js`
  - `apps/api/src/llm/nvidia-unlim.ts` 顶部常量

## 故障域

- 它挂 → LLMRouter 跳到下一个 provider（deepseek / openai）
- 主 server 挂 → 它无影响，可被其他业务（如脚本 / 第三方 / Prompt Playground）独立调用

## 不要做的事

- 不要往这里加业务逻辑（鉴权、计费、记忆）。它只是 LLM 适配层。
- 不要让它依赖 `@yelan/shared` —— 保持纯净，便于将来开源 / 拆分。
