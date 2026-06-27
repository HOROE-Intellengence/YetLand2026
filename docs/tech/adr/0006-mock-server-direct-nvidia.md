# ADR-0006: 本地 mock-server 直连 NVIDIA，不走 wrangler dev 代理

- **状态**: Accepted
- **日期**: 2026-05-10
- **决策者**: 工程团队

## 背景

ADR-0002 决定 `apps/unlim-worker/` 独立部署到 Cloudflare Edge，作为夜阑 LLMRouter 的主路径之一。生产环境里 `apps/server` 通过 `UNLIM_WORKER_URL` 调它没有问题。

但本地开发场景（`apps/mock-server`）出了问题：mock-server 的 `nvidia-unlim` provider 通过 `fetch('http://127.0.0.1:8788/api/chat')` 调本地 `wrangler dev`，**首请求成功后续永久 hang**。Windows 11 + Node v24 + wrangler 4.90 复现稳定。

排查记录：

1. `wrangler dev` 把上游 `Response.body` 直接透传（`apps/unlim-worker/src/worker.js`），workerd 在 SSE 流结束后**未发 chunked-encoding 终止帧 / TCP FIN**。
2. Node `fetch`（undici）严格等 `end`，于是 hang。改用 `node:http` + `[DONE]` 检测 + `req.destroy()` 也只能救一次——前一个未关连接占住 workerd 单线程，后续请求全部排队。
3. MSYS2 curl 阶段 1 偶发成功、wrangler 重启后 connect timeout，进一步说明 workerd 在 Windows 下的 socket 收尾不稳定。
4. 直连 NVIDIA `/v1/chat/completions` + `stream:true` 已在阶段 1 验证通畅；阶段 4 的"超时"实际是用了 `stream:false`，与本路径无关。

## 选项

- A. **修 wrangler / 等 wrangler 修**：上游 issue，不可控。
- B. **mock-server 用 `node:http` + 主动 destroy 绕开**：单次能跑，但 workerd 死锁后整个 worker 失效，不能重复跑。
- C. **mock-server 直连 NVIDIA**，不再走 wrangler dev 当代理。生产仍由 `apps/server` 走部署版 unlim-worker（线上 workerd 行为正常，已验证）。

## 决策

选 **C**。

`apps/mock-server/src/llm/nvidia-unlim.ts` 直接 POST `https://integrate.api.nvidia.com/v1/chat/completions` + `stream:true, stream_options:{include_usage:true}`，并复刻 `unlim-worker` 的 `DIRECT_RESPONSE_PROMPT` 注入与白名单模型解析。需要 `NVIDIA_API_KEY`（根 `.env` 已加载，由 `bootstrap-env.ts` 兜底）。

## 后果

- 本地开发**不再需要起 wrangler dev**。`pnpm dev:unlim` 仅用于测 unlim-worker 自身改动。
- mock-server 与 unlim-worker 之间出现**轻量重复**：`DIRECT_RESPONSE_PROMPT` 字面量、`MODELS` 白名单各一份。可接受——unlim-worker 仍按 ADR-0002 的"不依赖 `@yelan/shared`"原则保持纯净，不引入跨 app 共享层。两边漂移由文档显式约束（见下）。
- `apps/server/src/llm/providers/nvidia-unlim.ts`（生产路径）**保持不变**，仍走 `UNLIM_WORKER_URL` 代理。线上不存在该 wrangler dev bug。
- `UNLIM_WORKER_URL` 环境变量在 mock-server 路径下成为死代码，可清理或保留。
- 后续若 `DIRECT_RESPONSE_PROMPT` / 模型白名单需要修改，**两处同步**：`apps/unlim-worker/src/config.js` + `apps/mock-server/src/llm/nvidia-unlim.ts` 顶部常量。
