# Fish 与 Gemini Live 配置及网络诊断

本轮为只读配置巡检及主动网络探测，没有切换提供商、修改代理、DNS、密钥或线上请求链路。公开探测在 2026-10-09 07:53 UTC 左右完成，网络结论只代表这些节点和当时状态。

## 当前实际配置

| 配置项 | 本机开发环境 | 服务器容器 |
| --- | --- | --- |
| Fish Base URL | `https://api.fish.audio` | `https://ingress.yetland.com/fish` |
| Fish 实际 TTS 请求 | `POST https://api.fish.audio/v1/tts` | `POST https://ingress.yetland.com/fish/v1/tts` |
| Fish 模型 | `s2.1-pro-free` | `s2.1-pro-free` |
| Fish 鉴权 | `VOICE_HQ_FISH_API_KEY` 已配置，Bearer 请求头 | 同名环境变量已配置，Bearer 请求头 |
| Fish 输出请求 | WAV、24 kHz，音色可用 `reference_id` 指定 | 相同 |
| Live 连接 URL | `wss://yelan-voice-relay.horolelts.workers.dev/google-live` | `wss://ingress.yetland.com/google-live` |
| Live 模型 | `gemini-3.8-live` | 本轮使用该模型初始化成功 |
| Live 鉴权 | `VOICE_RELAY_TOKEN` 已配置 | 同名环境变量已配置 |
| 本机显式代理 | `VOICE_LOCAL_PROXY_URL=http://127.0.0.1:7897` | 未配置，本机代理设置在 server 模式被忽略 |
| Google API Key | 夜阑 API 进程未配置 | 夜阑 API 容器未配置；设计中保存在 Worker Secrets |

服务器环境未配置 HTTP_PROXY、HTTPS_PROXY、ALL_PROXY。服务器使用的是应用级 Cloudflare 转发，不是把所有出站请求改走本机代理。

Fish 上游固定为官方 `https://api.fish.audio/v1/tts`。Live 最终上游是 Google AI Studio 密钥对应的 Gemini Developer API：

```text
wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent
```

`aistudio.google.com` 是控制台，不是 Live 的 WebSocket API 地址。当前夜阑后端先连接 Cloudflare Worker，再由 Worker 连接 Google；如果“直连”要求夜阑后端直接连接 Google，当前实现不符合该要求。当前链路也没有通过 Horoe 的 OpenAI 兼容接口生成 Live 语音。

依据为实际服务器环境、本机配置、`apps/api/src/voice/config.ts`、`voice/live.ts`、`voice/local-proxy.ts`、`voice-hq/providers.ts`、`apps/voice-relay/src/index.ts`，以及此前双入口转发部署记录。当前 Google 握手成功不等于已经读取 Worker Secrets；本轮 Cloudflare 管理 API 的现存 OAuth token 失效，未能重新读取已部署 Worker 源码或 Secrets，没有修改其鉴权。

## 本机与服务器直接实测

| 测试 | 结果 |
| --- | --- |
| 本机不使用应用显式代理访问 Fish 官方域名 | `UND_ERR_CONNECT_TIMEOUT`，约 10.7 秒 |
| 本机不使用应用显式代理访问 Google 官方域名 | `UND_ERR_CONNECT_TIMEOUT`，约 10.7 秒 |
| 本机经 7897 代理鉴权读取 Fish 音色列表 | 200，约 8.7 秒 |
| 本机经 7897 代理访问 Google（无 Google key） | HTTPS 403；WebSocket 返回 1008，理由为未注册调用者／缺少凭据，说明已到 Google |
| 本机经 7897 代理连接旧 workers.dev Live 地址 | 收到 `setupComplete`，约 6.5 秒 |
| 服务器直连 Fish 官方域名 | `ETIMEDOUT`，未收到 HTTP 响应 |
| 服务器直连 Google 官方 HTTPS／WebSocket | `ETIMEDOUT`，未收到应用层响应 |
| 服务器经当前 `/fish` 中继鉴权读取音色列表 | 200，约 3.4 秒 |
| 服务器经当前 `/google-live` 中继初始化 Live | 收到 `setupComplete`，约 1.5 秒 |

普通 GET 请求带正确 relay token 返回 426，表示这个接口要求 WebSocket Upgrade，不能视为连接失败。

最近的服务器持久化记录中，2026-10-08 03:33 UTC 的失败分别为 `VOICE_UPSTREAM_CONNECTION_FAILED` 和 `HQ_STAGE_FAILED`；随后两种模式各有两条完成记录，最新为 2026-10-09 07:41 UTC 左右。本轮仅查询模式、状态、错误码、数量与时间，没有读取或外发真实用户输入输出。

上一轮上线验收已实际生成并读取两种语音：Fish TTS 13,667 字节，Live 26,390 字节；本轮新探测只读取音色列表、建立并关闭 Live 初始化会话，没有重复发送文本生成语音。

## 网上多地区 Ping 与 HTTPS 探测

使用 [Globalping 官方 API](https://globalping.io/docs/api.globalping.io)，每项选取大陆、香港、新加坡、美国、荷兰各一个公开节点，共六个测量、三十个节点结果。没有向该平台传入任何 API Key、relay token、账号、验证码或用户语音。

| HTTPS 目标 | 中国大陆 | 香港 | 新加坡 | 美国 | 荷兰 |
| --- | --- | --- | --- | --- | --- |
| Fish `GET /v1/tts`，无凭据 | TCP 超时 15 秒 | 404，305 ms | 404，80 ms | 404，172 ms | 404，186 ms |
| Google `GET /v1beta/models`，无凭据 | TCP 超时 15 秒 | 403，766 ms | 403，70 ms | 403，133 ms | 403，41 ms |
| 当前 relay `GET /google-live`，无凭据 | 401，803 ms | 401，104 ms | 401，105 ms | 401，135 ms | 401，128 ms |

海外 HTTPS 的证书校验均通过，中继五地 HTTPS 证书校验均通过。Fish 返回 404 是本轮用 GET 探测 POST 路由的结果；Google 403 的响应明确为未带调用者凭据。二者都证明网络和 HTTPS 可以到达，不能当成生成接口调用成功，也不能据此判断地区授权通过。中继的 401 同样来自没有提供 token。

Ping 方面，大陆 Fish 与 Google 节点均为 100% 丢包，香港／新加坡／美国／荷兰为 0% 丢包；中继五地均为 0% 丢包。ICMP 丢包本身不足以判断 API 可用性，本轮同时使用 TCP、TLS、HTTPS 与真实鉴权／WebSocket 初始化作为依据。

测量原始结果可由对应 Globalping API 查询：

- Fish Ping：`https://api.globalping.io/v1/measurements/2vXavNJjaehu3aT8100021Hej`
- Fish HTTPS：`https://api.globalping.io/v1/measurements/23BPKvHJ91RPri5T900021Hej`
- Google Ping：`https://api.globalping.io/v1/measurements/2voKjvuhlH2blXPZx00021Hej`
- Google HTTPS：`https://api.globalping.io/v1/measurements/2WYotOeRdXDRvAaVE00021Hej`
- Relay Ping：`https://api.globalping.io/v1/measurements/2uCnu6f3SIhIeDpZG00021Hej`
- Relay HTTPS：`https://api.globalping.io/v1/measurements/29BAad5fhk16sajTv00021Hej`

在线测量有平台保留时限，本机原始结果另存 `.server/voice-globalping-results.json`，摘要为 `.server/voice-globalping-summary.json`。

## DNS、代理与地区判断

Fish 的大陆解析结果明显异常：本机 IPv4 为 `203.111.254.117`，服务器为 `179.60.193.16`，大陆公开节点为 `210.209.84.142`／`173.244.217.42`，IPv6 出现 `2a03:2880:*`；四个海外地区解析为 Cloudflare `104.18.0.100` 或 `104.18.1.100`，且 HTTPS 证书匹配 `api.fish.audio`。结合连接失败，强烈支持大陆路径存在 DNS 污染或解析干扰。

进一步仅对测试请求指定两个海外解析 IP，保留原域名及 TLS 证书校验、不修改系统 DNS，结果本机和服务器均 `ECONNRESET`。因此不能把原因缩小为只有 DNS；该路径还有连接／TLS 层面的阻断或干扰，单改 DNS 不足以恢复 Fish。

本机明确使用应用代理后、服务器使用 Cloudflare 中继后均可以成功访问。证据支持失败发生在大陆直连网络路径，不能据此把每次历史失败都归因于某个代理节点，也不支持“Fish 或 Google 服务全局宕机”的判断。

[Google 官方可用地区列表](https://ai.google.dev/gemini-api/docs/available-regions) 未包含中国大陆。网络 TCP 超时与 Google 的地区授权限制是两个问题：本轮大陆直连请求尚未到达能返回地区错误的阶段，因此没有得到实际的地区拒绝响应。香港能连 HTTPS，也不代表可用地区授权通过；若需要新的官方直连出口，应选当前官方支持的新加坡、美国等地区并验证同一 key 的鉴权及 Live 初始化。

当前线上中继可以使用 Google 官方模型。若必须让夜阑后端直连 Google，需另行处理后端的 Google key 托管与受支持地区出站；不能只把 `VOICE_RELAY_URL` 换成 Google 地址，因为当前实现要求 relay token 和 `/google-live` 路径，会拒绝这种配置。

官方配置依据：[Google Live WebSocket API](https://ai.google.dev/api/live)、[Fish 开发者 API](https://fish.audio/developers/)。本轮没有修改已有线上链路。
