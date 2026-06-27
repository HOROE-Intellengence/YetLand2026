# apps/api

Node + Hono 主后端。**不依赖 wrangler / Cloudflare 账号**，启动即可联调。

## 设计原则

1. 路由签名与 `apps/server/` 1:1 对齐 —— 切换 `VITE_USE_MOCK=false` 后前端无需改代码就指向真实 server。
2. 共用 `@yelan/shared` 的 zod schema 校验，避免 mock 漂离生产口径。
3. SSE 模拟流必须包含 `kind:'meta'` / `kind:'chunk'` / `kind:'done'` 三种事件，并能产出 `glow:true` 的关键句让前端跑出停顿动画。
4. 写动作只打 `console.log`，不做持久化（如果需要演示态保留，落到 `.local/`，列入 `.gitignore`）。
5. 侧袋 AI 保持薄实现：固定 prompt + 便宜模型 + zod 校验 + fallback，不引入 `agent_config` / 独立 Agent 平台。

## 与 apps/server 联动模式

根目录 `pnpm dev:server` 会复用/启动本服务（默认 `127.0.0.1:8787`），再启动 `apps/server`（默认 `127.0.0.1:8789`），由 server 的 `mock-fallback` 把缺口功能代理回来。

这只是本地/测试桥，不是生产架构。`apps/api` 仍是当前 Docker 路线的完整实现；Workers 生产化应逐路由迁移，不应长期依赖反向代理。

## 加新路由的步骤

1. 在 `src/routes/<name>.ts` 写 stub 处理函数；
2. 在 `src/index.ts` 挂上 `app.route('/api/<name>', ...)`；
3. 如有数据，在 `src/fixtures/` 加假数据，**不要在路由文件里硬编码**。

## 与真实 server 的差异

| 项 | mock | 真实 |
|---|---|---|
| 鉴权 | 任意 token 通过 | JWT / session lookup |
| 流式 | 固定剧本 + 句级元数据；如 `NVIDIA_API_KEY` 已配则 `nvidia-unlim` provider 也可用 | LLMRouter 真实流 |
| 侧袋 AI | `src/sidecar-ai/` 薄调用；无 key 时规则降级 | 未来按同协议迁移 |
| 幂等 | 无 | INSERT ON CONFLICT DO NOTHING |
| 速率限制 | 无 | Redis 滑窗 |

## LLM provider 接入

本地 `LocalLLMRouter` 注册四个 provider，按 `process.env.*_API_KEY` 自动激活：

| provider | 路径 | 备注 |
|---|---|---|
| `anthropic` | `https://api.anthropic.com` | `ANTHROPIC_API_KEY` |
| `openai` | `https://api.openai.com/v1` | `OPENAI_API_KEY`，可改 `OPENAI_BASE_URL` |
| `deepseek` | `https://api.deepseek.com/v1` | `DEEPSEEK_API_KEY` |
| `nvidia-unlim` | **直连** `https://integrate.api.nvidia.com/v1` | `NVIDIA_API_KEY`；详见 ADR-0006 |

**重点**：`nvidia-unlim` 在本地**不走 `wrangler dev` 代理**——见 [ADR-0006](../../docs/tech/adr/0006-mock-server-direct-nvidia.md)。生产路径仍由 `apps/server` 通过 `UNLIM_WORKER_URL` 调部署版 unlim-worker。

修改 `DIRECT_RESPONSE_PROMPT` 或模型白名单时需同步两处：
- `apps/unlim-worker/src/config.js`
- `apps/api/src/llm/nvidia-unlim.ts` 顶部常量

## 侧袋 AI

5 个侧袋任务位于 `src/sidecar-ai/`：

| 文件 | 职责 |
|---|---|
| `atmosphere-judge.ts` | 每轮判断温度 1-5；IF 暗号命中只作为 prompt 上下文信号，不再强制 4/5 温度下限 |
| `output-structurer.ts` | 将主 AI 输出拆成 `dialogue/action/environment/narration` |
| `preference-recorder.ts` | 每 5 次用户输入提取画像，写入 `state.userProfiles` + 记忆表 |
| `quota-ending.ts` | 额度耗尽时生成自然收束指令；无 key 时也有 fallback |
| `context-compressor.ts` | 超出最近 15 轮的旧对话压缩为 `state.contextSummaries` |
| `prompts.ts` | 5 个默认 prompt；运行时优先读 `state.sidecarPrompts`；`atmosphereJudge` 含 V1/V2 双版本，`FEATURE_TEMP_V2` 控制默认值 |
| `client.ts` | OpenAI-compatible 薄调用，支持 `taskKey` 选用任务专属渠道（见下方）；优先 `SIDECAR_API_KEY`，其次 `DEEPSEEK_API_KEY` |

后台入口：`/api/admin/sidecar-prompts`，控制台面板：`#sidecar-prompts`。

### 侧袋任务级渠道

`preferenceRecorder` / `quotaEnding` / `contextCompressor` 三类后台任务可以单独绑定 API entry，与温度 AI / 拆句 AI 共用的"普通侧袋渠道"分离。绑定走 `POST /api/admin/llm-apis/select-task`，UI 在 `ServiceConfig` 面板的"侧袋任务渠道"区域。被任务绑定的 entry 不会出现在主 AI 的 `getEnabledLlmApiConfigs()` fallback 列表里，避免任务专用 key 被主路由误用。env 兜底见 `SIDECAR_TASK_API_KEY` / `SIDECAR_TASK_BASE_URL` / `SIDECAR_TASK_MODEL`。
