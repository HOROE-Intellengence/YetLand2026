# ADR-0002: NVIDIA 限制解除器作为独立 Worker，不内联到主 server

- **状态**: Accepted
- **日期**: 2026-05-07
- **决策者**: 工程团队

## 背景

`apps/unlim-worker/` 来自现成的 `unlimited-ai` 项目，部署在独立的 Cloudflare Worker 上，向 NVIDIA NIM 转发 chat completion 并附加"无限制"的 system prompt。它会成为 LLMRouter 的主路径之一（修订 #4 流水线提到的便宜模型 / 直回风格）。

## 选项

- A. **保留独立 Worker**，主 server 通过内部 URL 调用。
- B. **内联**：把 `nvidia.js`/`unlim.js` 拷到 `apps/server/src/llm/providers/nvidia.ts`，按一个 provider 处理。

## 决策

选 **A**。

理由：
- 故障域隔离：unlim-worker 的 NVIDIA 凭据/速率/重试逻辑独立演化，不会污染主 server 部署节奏。
- 灰度自由：可以单独把 unlim 流量切到不同 NVIDIA 项目 / 自部署模型，而无需重启主 server。
- 工程量：内联也得保留同样的 `direct response prompt` 和模型映射，省不了多少。
- 合规可拔：监管收紧时，主 server 一行配置切走 unlim，无需改路由代码。

## 后果

- 主 server `llm/providers/nvidia-unlim.ts` 是一个薄 HTTP 客户端，URL 由 `UNLIM_WORKER_URL` 注入。
- unlim-worker 自己继续用 `wrangler.toml` 部署，受主 server 的 LLMRouter 调度但不在 monorepo 任务依赖图上耦合（其 `package.json` 不依赖 `@yelan/shared`，保持纯净）。
- mock-server 也要 mock 这条 provider，让前端联调不依赖真实 NVIDIA。

## 后续修订

- **2026-05-10**：本地 mock-server 不再走 `wrangler dev` 代理 —— 见 ADR-0006。生产路径（`apps/server` → 部署版 unlim-worker）不受影响。
