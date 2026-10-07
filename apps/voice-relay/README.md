# Google Live 出站中转

这是独立的出站 Worker，和 `apps/server` 的入站 edge 层无关。
只接受 `GET /google-live` WebSocket 升级；不接受自定义目的地、路径或查询参数。
Node API 使用 `Authorization: Bearer <RELAY_TOKEN>`，Worker 以 Secret 中的 Google key 建立上游连接。

当前已部署地址：`wss://yelan-voice-relay.horolelts.workers.dev/google-live`。
2026-09-29 已配置两项 Worker Secret，并接通本机 `apps/api`。无凭据访问返回 401。
此地址供后端使用，不是用户打开即可聊天的网页。正式服务器仍需从实际机房验证连通性。

## 部署

Windows 普通 PowerShell 若找不到 pnpm，可直接使用本机已有的 Node 和 Wrangler 登录，无需安装全局工具：

```powershell
Set-Location 'D:\YL\apps\voice-relay'
& 'C:\Users\linsh\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' '.\node_modules\wrangler\bin\wrangler.js' login
```

这两个路径已在当前开发机核验；浏览器打开后完成 Cloudflare 授权，保留终端直到登录结束。

从仓库根执行（项目使用 pnpm 9；系统版本不匹配时可通过 `pnpm dlx pnpm@9.15.9 ...` 执行相同命令）：

```sh
pnpm --filter @yelan/voice-relay exec wrangler login
pnpm --filter @yelan/voice-relay exec wrangler deploy
pnpm --filter @yelan/voice-relay exec wrangler secret put GOOGLE_API_KEY
pnpm --filter @yelan/voice-relay exec wrangler secret put RELAY_TOKEN
```

首次部署未配置 secrets 时返回 503。两项 Secret 完整后才接收转发。
RELAY_TOKEN 使用密码工具生成至少 32 个随机字符，并将同一值配置到 API 的 VOICE_RELAY_TOKEN；不要写进命令参数、代码或聊天。
Google key 使用用户指定参考页中的现有 key，通过交互输入配置，不复制到主后端或前端。

API 配置：

```dotenv
VOICE_RELAY_URL=wss://实际Worker域名/google-live
VOICE_RELAY_TOKEN=与Worker中的RELAY_TOKEN相同
```

生产建议在 Cloudflare 控制台为 Worker 绑定自有子域名，并从实际服务器验证 DNS、TLS 和 WSS；仅在本机可访问不等于服务器可访问。
测试与生产建议分别部署不同 Worker 和 token。

## 本地模拟

复制 `.dev.vars.example` 为 `.dev.vars` 后填入测试 secrets，运行 `pnpm --filter @yelan/voice-relay dev`。
Node API local 模式可使用 `ws://127.0.0.1:8790/google-live`，server 模式只接受 WSS。
本地 Wrangler 模拟器的出站请求仍依赖本机网络；它不是远程代理。若本机不能访问 Google，应连接已经部署的远程 Worker。

Worker 不保存音频、不修改提示词、不重试生成，也不记录请求正文或凭据。只透传成功的升级响应，拒绝信息统一脱敏。
免费额度只涵盖 Worker 的相应请求额度，不涵盖 Gemini 模型用量。

参考：[WebSockets](https://developers.cloudflare.com/workers/runtime-apis/websockets/)、[Secrets](https://developers.cloudflare.com/workers/configuration/secrets/)。
