# UnLim NVIDIA Module

本项目已精简为一个 Cloudflare Worker API 模块，只负责：

1. 接收外部聊天请求。
2. 过滤并规范化用户消息。
3. 注入统一的直给响应风格系统提示词。
4. 调用 NVIDIA `chat/completions` API。
5. 将 NVIDIA 的 SSE 流式响应原样返回给调用方。

不再包含网页 UI、打赏弹窗、本地历史、浏览器端角色配置、静态资源托管等非核心功能。

## 当前结构

```text
unlimited-ai/
├─ src/
│  ├─ config.js      # NVIDIA 端点、默认模型、模型白名单、直给风格提示词
│  ├─ nvidia.js      # NVIDIA API 调用封装
│  ├─ unlim.js       # 消息净化、模型解析、系统提示词拼装
│  └─ worker.js      # Cloudflare Worker API 入口
├─ README.md         # 使用、接口和部署说明
├─ LICENSE           # 授权信息
└─ wrangler.toml     # Worker 部署配置
```

## 核心模块说明

### `src/config.js`

集中配置：

- `NVIDIA_CHAT_COMPLETIONS_URL`
- `DEFAULT_MODEL`
- `MODELS`
- `DIRECT_RESPONSE_PROMPT`
- `DEFAULT_STREAM_OPTIONS`

### `src/unlim.js`

核心限制处理/请求整理层：

- `getAllowedModels()`：返回对外可见模型列表。
- `resolveModel(modelId)`：只允许白名单模型，非法模型回退到默认模型。
- `normalizeMessages(messages)`：只保留 `user` / `assistant` 消息，并清理空内容。
- `buildUnlimMessages()`：拼装系统提示词与用户上下文。

### `src/nvidia.js`

NVIDIA 交互层：

- 检查 `NVIDIA_API_KEY`。
- 调用 `https://integrate.api.nvidia.com/v1/chat/completions`。
- 固定使用流式输出。
- 把上游错误转成异常交给 Worker 处理。

### `src/worker.js`

接口入口：

- `OPTIONS *`：CORS 预检。
- `GET /health`：健康检查。
- `GET /api/models`：模型列表。
- `POST /api/chat`：聊天接口，返回 SSE 流。

## 对外接口

### `GET /health`

返回：

```json
{
  "ok": true,
  "module": "unlim-nvidia"
}
```

### `GET /api/models`

返回默认模型与模型白名单。

### `POST /api/chat`

请求体：

```json
{
  "model": "deepseek-ai/deepseek-v4-pro",
  "system_prompt": "optional extra system prompt",
  "messages": [
    { "role": "user", "content": "Hello" }
  ]
}
```

返回：NVIDIA 上游 SSE 流。

## 部署

```bash
npm i -g wrangler
wrangler login
wrangler secret put NVIDIA_API_KEY
wrangler deploy
```

## 已删除/移除

- `public/index.html`
- `public/app.js`
- `public/config.js`
- `public/styles.css`
- `wrangler.toml` 中的 `[assets]` 静态资源绑定
- 前端本地历史
- 前端自定义角色设置
- 打赏弹窗
- GitHub UI 链接
- 静态 `/config.js` 注入接口
