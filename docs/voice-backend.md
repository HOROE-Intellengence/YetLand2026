# 语音对话后端

## 当前高质量语音 TTS：Fish Audio（2026-10-02）

已由 Gemini TTS 切换至 Fish Audio，模型固定为 `s2.1-pro-free`，通过 `model` 请求头发送，失败不回退付费模型或 Google。普通 Live 入口、阿里 ASR 和文字主模型不变，保留语音开始后逐字浮入的前端效果。

- 环境变量：`VOICE_HQ_FISH_API_KEY`、`VOICE_HQ_FISH_BASE_URL=https://api.fish.audio`。真实 key 仅保存在后端忽略文件或服务器环境，旧 `VOICE_HQ_TTS_*` 不再用于当前 TTS。
- 接口：`POST https://api.fish.audio/v1/tts`，原回复放 `text`，指定音色放 `reference_id`，输出请求 WAV / 24 kHz，验格式后转持久化 Opus。维护备注不混入朗读文本。
- 可视化后台：`/admin#voice-settings`（语音配置与测试）。只保留成熟女、成熟男、少年男、少女四个默认项，手动填写 Fish reference_id；保存后下一轮生效。角色继续从四类中选择，没有音色库、入库或独立角色绑定。
- `fish_voice_defaults` 保存四个默认 ID 与版本。初始留空，留空使用 Fish 默认声音，不把旧 Google 音色名当作 Fish 音色。
- 语音测试支持手动测试 ID、测试文字、Fish 搜索与试听；测试不会写入默认配置，也不增加用户重播入口。
- 每轮快照保存 provider/referenceId/语速/版本，修改默认项不改变进行中或 TTS 重试的音色。旧 Gemini 样本与历史快照保留，但不允许用 Fish 重试旧 Gemini 合成。
- 后台接口前缀 `/api/admin/voice-hq`：GET `/`、GET `/catalog`、PUT `/slots/:category`、POST `/preview`。管理员鉴权、修改审计，API key 不返回浏览器。

本地验收（2026-10-02）：精简版 HQ 23 项测试通过，普通语音/管理员语音/签名 34 项回归通过；API、前台、后台类型检查和前后台构建通过。浏览器实测四类 ID 手填保存与刷新持久化，手动 ID 试听完整播放 5.019 秒。完整真实链路轮次 `50a3589e-d702-42e8-83f7-f15f8745b39a` 使用 Fish `s2.1-pro-free`，36 字回复，主模型 1957 ms、TTS 11232 ms、总计 13195 ms，前台播放完成并显示字幕。此前一轮在文字主模型上游流空闲 30 秒后失败；重试成功，没有切换模型。测试数据在隔离目录，正式四个 ID 留空供手填。local 签名/ASR 仍跳过，不算服务器闭环通过。

[Fish TTS 官方接口](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech) / [音色列表接口](https://docs.fish.audio/api-reference/endpoint/model/list-models)。下文 2026-10-01 的 Gemini 测试记录是迁移前历史记录。

## 高质量语音：ASR 短效签名（2026-10-01）

### IF 暗号真实模型验收（2026-10-02）

高质量语音页面新增右上角温度计：仅当前会话 IF 已激活后显示，数值来自该轮实际温度，不以账号永久解锁代替会话状态。轮询期间即时更新，离开重进恢复，开始新会话/切换角色清空。无实际温度时显示待计算。浏览器实测暗号触发后主模型生成阶段出现 `3/5`，播放结束仍显示，重进恢复、新会话隐藏通过；截图 `.local/fish-migration/hq-if-thermometer.jpg`。服务和主模型 15 项测试通过，API/前台类型检查、前台构建通过。

隔离会话 `hq_8745116e-ad0d-418d-8d83-d6ea971c274b` 复制当前后台配置，使用沈砚之、现有启用暗号「花好月圆」与原版日常/IF 前置卡，未修改提示卡、未模拟主模型或 TTS。三轮完整成功：普通输入使用 `daily-default`，暗号当轮切换 `if-default`，后续不带暗号继续使用 `if-default`。每轮抓取实际 HTTP 请求体，与 SQLite 提示词快照逐字比对一致；后两轮实际 system 内容完整包含 850 字 IF 卡且不包含日常卡。主模型 `gemini-3.5-flash-lite`、Fish `s2.1-pro-free` 均 HTTP 200，TTS 输入与主模型完整输出一致；总耗时分别 16.220 / 8.572 / 6.895 秒。当前暗号没有配置强制温度，不能将 IF 触发等同于立即跳温。这组非性话题输出仍较克制，证明的是实际前置切换，不据此夸大风格效果。证据：`.local/if-live-1790949170523/results.json` 及各轮 `*-requests.json`、`*-system.txt`、音频。local 以文字模拟 ASR 结果，实际口述识别仍未验收。

新增 `POST /api/voice/asr-assets/:assetId/sign`（要求该录音所有者的用户 token），仅允许签发输入录音。
`DEPLOY_MODE=server` 时返回 `{skipped:false,url,expiresAt}`；阿里通过该 URL 的 GET/HEAD 下载，无需用户 token，支持单段 Range。
HMAC-SHA256 绑定用途、配置域名、录音 id、所有者、轮次、音频哈希、签发时间和到期时间。

配置：`VOICE_ASR_PUBLIC_ORIGIN` 为公网 HTTPS 源站（不带路径），`VOICE_ASR_SIGNING_KEY` 为独立至少 32 字符的随机密钥，`VOICE_ASR_SIGNING_TTL_SECONDS` 默认 900（60–3600）。源站来自配置，不采用请求 Host；服务器缺配置返回 503。
输入文件仍保留在原语音持久卷，签名下载按原始哈希验完整性，普通音频接口保持登录鉴权。回复音频不可签发。到期或密钥轮换后链接失效。

`DEPLOY_MODE=local` 时，签发接口明确返回 `{skipped:true,reason:"LOCAL_SIGNATURE_SKIPPED",url:null,expiresAt:null}`，公开下载路由返回 404；调用方应跳过真实 ASR，不能将其当作空转写或成功。
本地可执行 `node scripts/asr-signature-check.mjs`，只报告 SKIPPED，不发出网络请求。
服务器构建前后测试清单见 `docs/TODOlist.md` TEST-111/112。离线隔离测试不代表公网或阿里下载验收通过。

“语音（高质量）”已接通阿里 Filetrans → 文字内核 → Gemini TTS，当前完成本地验收；服务器签名与真实 ASR 闭环仍待 TEST-111/112。


## 高质量语音业务（本地验收完成，2026-10-01）

开场页「语音（高质量）」是独立入口。按住录音、松开发送，单轮期间禁用重复发送，离开页面停止本机播放，后台保留处理中任务。无重播按钮；浏览器阻止自动播放时只提供未播放回复的首次播放按钮。

- `apps/api/src/voice-hq` 调用原文字 `assembleSystemPrompt` / `streamMainLLM`，采用后台主模型与推理档位、角色卡、文字前置、阶段、边界和氛围判断；不使用普通 Live 的 `voice-global`。
- 仅调用 atmosphereJudge；不调用 outputStructurer、preferenceRecorder、contextCompressor、quotaEnding，也不运行文字后处理钩子。历史保留完整已生成的双方文字，超过字符预算明确要求新会话，不偷偷裁剪或概括。
- 按文字对话规则消耗轮次。TTS 失败保留原文和音色快照，显式重试只做合成，不再次扣文字轮次；额度用完采用固定文案，不调用结束侧袋。主模型失败不自动再次生成。
- 角色 `hqVoiceProfileId` 独立绑定：成熟女 Despina 15、成熟男 Alnilam 11、少年 Puck 4、少女 Leda 17。保留已批准完整 style，17 是夹子音版本。后台和自建角色表单可选；旧角色按普通音色映射默认值。
- TTS 使用 `gemini-3.8-flash-tts`，文字逐字传入 `parts[].text`，风格单独传 `speech_metadata.style`，按 [Google 3.8 TTS 文档](https://ai.google.dev/gemini-api/docs/generate-content/speech-generation) 配置 `speechConfig.voiceConfig.voice`。输入 Opus 24 kbps，回复 Opus 48 kbps；播放时解码 PCM16 / 24 kHz。
- 配置 `VOICE_HQ_TTS_API_KEY`、`VOICE_HQ_TTS_BASE_URL`、`VOICE_HQ_ASR_API_KEY`、`VOICE_HQ_ASR_BASE_URL`、`VOICE_HQ_ASR_MODEL`，示例见 `.env.example`；密钥只在后端环境。`VOICE_HQ_CONTEXT_MAX_CHARS` 默认 48000。
- 同一 voice.sqlite 使用独立 `hq_sessions` / `hq_turns` / `hq_tts_retries` 记录阶段、task_id、主回复完成标记、音色快照和耗时。会话 ID 使用 `hq_` 前缀，普通 Live/文字入口不能续接 HQ 会话，文字最近会话查询排除它。
- 后台原「语音记录」可查看双方文本和已保存音频，模式列区分普通/HQ。沿用原管理员鉴权，不在用户端增加重播。

### HQ 接口

全部要求用户登录，除本地测试外客户端不能指定音色或传入替代转写。

| 方法与路径 | 用途 |
| --- | --- |
| GET `/api/voice-hq/config` | localTest 和 replay=false |
| POST `/api/voice-hq/sessions` | `{characterId}` 创建会话 |
| GET `/api/voice-hq/sessions/:id` | 恢复角色与关闭状态 |
| POST `/api/voice-hq/sessions/:id/turns` | 录音原始字节，UUID Idempotency-Key |
| POST `/api/voice-hq/sessions/:id/turns/text` | 仅 local 接受 `{text}`；server 返回 404 |
| GET `/api/voice-hq/sessions/:id/turns[/:turnId]` | 状态、文字、失败原因、可恢复操作与耗时 |
| GET `/api/voice-hq/sessions/:id/turns/:turnId/audio` | 鉴权获取完整 PCM 供首次播放 |
| POST `/api/voice-hq/sessions/:id/turns/:turnId/retry-tts` | 显式重试合成，UUID Idempotency-Key |
| POST `/api/voice-hq/sessions/:id/turns/:turnId/resume-asr` | 只续查已有 task_id，不重新提交 |
| POST `/api/voice-hq/sessions/:id/close` | 取消进行中的工作并关闭会话 |

ASR 提交只尝试一次；网络结果不确定时记录 `HQ_ASR_SUBMISSION_UNKNOWN`，不能自动重提。轮询失败保留 task_id；显式续查仍用原任务。每轮显式恢复最多三次，重启标记 interrupted，不自动调用付费模型。

`DEPLOY_MODE=local` 下录音仍会校验并保存，但明确标记 `LOCAL_ASR_SKIPPED`，不签名、不调用 ASR、不把空文本送主模型。页面显示本地测试文字输入，用于真实主模型 → TTS → 自动播放验收，服务器不显示也不开放这个接口。

### 2026-10-01 本地验收证据

独立状态目录 `.local/hq-acceptance/state`，合成测试账号与测试角色，未使用真实用户历史。浏览器登录 → 独立入口 → 真实主模型 `gemini-3.5-flash-lite` → TTS Leda 17 → 自动播放完成；刷新后保留回复但不重播；第二轮回答「温水」正确承接首轮倒水情境。

| 轮次 | 主模型耗时 | TTS 含落盘 | 总处理耗时 | 音频时长 |
| --- | --- | --- | --- | --- |
| 1 | 4052 ms | 8096 ms | 12155 ms | 10440 ms |
| 2 | 2411 ms | 3928 ms | 6344 ms | 1240 ms |

自动回归 9 个测试文件共 79 项通过（含原 Live、文字聊天和后台语音记录）；API/web/admin 类型检查、web/admin 构建、新增功能 ESLint、接口契约检查通过。契约检查保留既有 user-character 映射警告，前端构建保留既有大包提示。

已核验 Ogg 文件哈希、未授权下载 401、同 key 重发不增轮次、温度日志存在而画像/概要为空、桌面和 390px 窄屏无横向溢出。耗时是两次本机实测，不代表稳定性能承诺。脱敏记录 `.local/hq-acceptance/evidence.json`，截图同目录。

本地签名前后检查均为 **SKIPPED，0 网络请求**。服务器构建前/后签名、公网过期/篡改拒绝、阿里真实拉取和容器持久卷恢复仍须按 TEST-111/112 执行，不能以本地模拟测试替代。

## 原普通 Live 语音范围

逐轮上传录音 → 输入 Opus 持久化 → Worker → Gemini Live → 回答 Opus 持久化 → 查询并播放。
业务实现位于 `apps/api/src/voice`，入口为 `/api/voice`。简易前端位于 `apps/web/src/scenes/VoiceScene.tsx`：开场页第二个选项进入，默认录音，右下角 Dev 开关启用文字输入；回答自动播放，浏览器限制时保留手动播放控件。
模型沿用参考页 `gemini-3.8-live`，音色为 Charon、Puck、Gacrux、Leda。

## 提示词

后台「前置提示卡」里的 `voice-global`（语音专用作用域）是唯一全局前置卡。
初始内容来自项目根 `[全局表达约束前置].md` 的原文副本 `packages/prompts/prelude-cards/voice-global.md`。
副本仅在首次缺卡时初始化；之后以后台存储内容为准，不会随重启覆盖编辑。后台停用时语音创建/生成返回错误，不偷偷回退到其它卡。

systemInstruction 精确拼接：`voice-global.content + 两个换行 + 所选角色卡内容`。
不调用原文字聊天的 system template，不注入日常/IF 卡、边界条款、温度、阶段策略、记忆摘要或额外语音说明。
历史用户/模型发言是对话上下文，不作为新增系统提示词；不做额外 LLM 摘要。
每轮新建上游连接，重新读取两项提示词，重放已完成历史。因此后台修改下一轮生效，无需重启 API；进行中的一轮使用已记录快照。
修改模型或音色需要创建新会话。角色访问权限每轮重验；本人私有卡可用，其他人的私有卡不可用。

## local 与 server

| 项目 | local | server |
| --- | --- | --- |
| API | Windows Node，默认 127.0.0.1:8787 | Docker Node 20，Caddy HTTPS |
| 数据目录 | `apps/api/.local/voice` | `/app/apps/api/.local/voice` → 宿主 `infra/deploy/_data/voice` |
| 出站 | 远程 Worker；或有 Google 通路的本机模拟器 | 远程 Worker，WSS |
| 转码 | PATH 中 ffmpeg，或 VOICE_FFMPEG_PATH | 镜像内 `/usr/bin/ffmpeg`，含 libopus |
| 密钥 | API 环境中只有 relay token | API 环境中只有 relay token；Google key 在 Worker Secret |

环境变量：`VOICE_RELAY_URL`、`VOICE_RELAY_TOKEN`；可选 `VOICE_DATA_DIR`、`VOICE_FFMPEG_PATH`。
配置缺失时语音生成明确返回 503，不影响原文字聊天，也不会偷偷直连 Google。
模型请求没有自动重试。示例配置不含任何真实凭据。

后端不依赖前端页面，可先按 [Worker 部署说明](../apps/voice-relay/README.md) 配置，再执行下方命令行验收。
修改后台源码后执行 `pnpm --filter @yelan/admin build`，8787/admin 才能看到新作用域选项。

## 接口

全部接口要求有效用户 Bearer token；ADMIN_TOKEN 不等同用户 token。

1. `POST /api/voice/sessions`，JSON：`{"characterId":"角色ID","voiceName":"Leda"}`，返回 201 和 `id`。
2. `POST /api/voice/sessions/:id/turns`，body 是音频文件原始字节（非 multipart、非 Base64），`Content-Type` 为对应音频类型，`Idempotency-Key` 必须为 UUID。输入压缩落盘完成后返回 202、turn id 和输入音频 URL。
3. `GET /api/voice/sessions/:id/turns/:turnId`：查询 `processing/complete/failed/interrupted`，双方转写、完整性、音频 URL、错误码。
4. `GET /api/voice/sessions/:id/turns`：当前会话所有轮次；用于进程重启/网络断开后恢复查询。
5. `GET /api/voice/assets/:assetId`：鉴权返回 `audio/ogg; codecs=opus`，支持单段 Range（206/416），禁止公共缓存。
6. `POST /api/voice/sessions/:id/close`：关闭会话，取消当前生成，保留已收到的音频。

同一会话、同一 Idempotency-Key、相同文件返回同一轮；不同文件返回 409。超时或失败后重复相同 key 不会重新扣模型费用。
客户端如要明确发起新尝试，必须使用新 key。生成失败不删除用户录音；已生成的部分音频可播放，但状态仍为失败/中断。

支持 WAV、Ogg/Opus、WebM、MP3、MP4/M4A、FLAC 音频上传。检查真实容器签名后解码，FFmpeg 禁用网络协议。
上传上限 12 MiB、单轮输入 120 秒、输出 180 秒；上传超时 30 秒。单用户同时一轮、后端全局最多 4 轮、单用户每分钟最多 10 次新生成。
语音限制独立于现有文字聊天配额，不扣文字轮次/蜡烛；商业计费未接入。

前端用带鉴权的 fetch 获取音频 Blob 后播放，不直接给 `<audio src>` 填一个需要 Bearer header 的 URL。
浏览器通过 MediaRecorder 录音，再点击麦克风结束并发送；无需启用 Dev。Dev 开启后显示文字框，调用 `POST /api/voice/sessions/:id/turns/text`，JSON `{text}`，同样要求用户鉴权与 Idempotency-Key。文字直接作为用户消息发送给同一语音模型，不追加提示词，不伪造输入录音，模型输出仍存 Opus。未实现 VAD 和插话打断。

## 音频与数据

- 长期只保存双方单声道 Ogg/Opus，目标 24 kbps VBR（估算每音频分钟 180 KB，含封装和 VBR 会浮动）。这是有损数据，不是无损训练母带。
- Gemini 输入为 PCM16 16 kHz，输出为 PCM16 24 kHz；转换在 Node 服务器，不在 Worker。
- `voice.sqlite` + WAL 保存会话、轮次、提示词快照/哈希、音频引用/哈希、转写、模型、用量、时间与错误码；没有音频 Base64。
- `assets/*.ogg` 保存已提交音频；写临时文件、fsync、rename、SQLite 提交后才对外发布。
- `pending/*.pcm` 是回答接收过程的故障恢复日志。正常归档成功即删除，磁盘/转码故障时保留，下次进程启动后的首次语音请求尝试恢复成 Opus。
- 重启将遗留 processing 标记 interrupted，不自动再次调用模型；双方已有录音保留。
- 输入/输出转写不完整时，下一轮用对应已保存音频恢复历史，不用不完整文本冒充完整上下文。
- 最多 100 个完成轮次，历史传输载荷上限 8 MiB；超过返回明确错误，用户开启新会话。不静默截断或注入摘要。
- `trainingConsent=0` 是预留字段；本次不进行训练或训练集导出。语音数据无自动过期清理，需按业务增长规划容量与备份。

当前实现面向一个 API 进程、一个持久卷。不要把多个 API 副本挂到同一个 voice 数据目录；多实例需另行设计任务租约与共享存储。

## 备份恢复

为取得 SQLite、state.json 和音频的一致快照，先停止 API，再备份整个 `infra/deploy/_data`，然后启动。
不要只备份 voice.sqlite 而漏掉 WAL 或音频。升级镜像不删除 `_data`；`docker compose down` 后重建仍使用该目录。
恢复时同样停 API，把备份目录恢复到原位置再启动。恢复后检查语音历史查询和两方向音频读取。
单文件原子写与数据库事务不能组成跨资源事务，极端掉电可能留下无索引文件；不得因此重试模型，离线对账后再清理孤立文件。

## 无前端验收

配置好 relay 后，使用测试账号的一条简短录音：

```powershell
$env:YELAN_USER_TOKEN = '测试用户的token'
node scripts/voice-smoke.mjs 'D:\recording.wav' '已有角色ID' Leda
```

可设置 `YELAN_API_BASE` 指向服务器；脚本保存 `<录音路径>.reply.ogg`，打印会话和轮次 ID，不打印密钥。
这是一次真实付费模型请求，脚本不会自动重试。需要验证多轮时，用同一 session id 调用接口。

自动测试：

```sh
pnpm --filter @yelan/api exec vitest run src/voice/voice.test.ts
pnpm --filter @yelan/voice-relay test
pnpm --filter @yelan/api typecheck
```

测试使用隔离临时目录、真实 SQLite 和 FFmpeg，以及本地模拟的 Google Live WebSocket；不读取真实用户数据、不调用 Google。
真实 Google 模型权限、音色可用性、远程 Worker 连通性与服务器线路只能由部署后的真实验收确认。

## 本次验证记录（2026-09-29）

- 全仓 TypeScript 检查通过；后台构建通过；接口契约检查通过。
- 后端全量回归 383/383 通过（测试子进程移除继承的模型 key、关闭真实 LLM；最初未隔离环境导致两个既有模型清单测试受 env-main 影响，隔离后通过）。
- 随后新增的语音故障/上下文用例连同原用例共 14/14 通过；Worker 用例 4/4 通过。新增代码 ESLint 通过。
- 真实 Windows FFmpeg 编解码、SQLite 重启读取、鉴权 Range 播放、本地模拟上游 WebSocket 已验证；未调用 Google 语音模型。
- Linux Docker 镜像构建通过，容器内 SQLite、Opus 编解码、HTTP 启动、语音接口鉴权及提示卡初始化通过；镜像未包含 apps/api/.env。
- 本机 8787 服务已备份状态后重启；后台 voice-global 卡与指定源文件内容一致，业务数据只有 preludeCards 字段变化。
- Worker 打包 dry-run 通过；后续已完成 Cloudflare 登录、Worker 部署和两项 Secret 配置。本地 API 已填写 relay 地址/token 并重启生效。

## 远程中转与真实录音验收（2026-09-29）

- Worker：`wss://yelan-voice-relay.horolelts.workers.dev/google-live`；没有认证的请求实测返回 401。
- 路径：本机 8787 API → 远程 Worker → Gemini 3.8 Live。测试输入由 Windows 本机语音合成产生，不使用真实用户历史录音。
- 独立测试账号「语音验收测试」，内置角色 `huo-jin`，音色 Leda；测试记录保留在本机持久化目录，trainingConsent 保持 0。
- 首轮成功：输入转写正确，角色返回自我介绍，双方音频均已持久化，并通过鉴权接口下载。
- 两轮上下文验收通过：先说「我今天带了一把蓝色雨伞」，下一轮询问颜色，模型正确回答「蓝色」。Google 的输入转写未标记 finished，后端实际通过持久化音频恢复了历史，没有插入额外摘要或提示词。
- 输入 Opus：约 3.93 秒、9,362 字节；输出 Opus：约 6.70 秒、20,200 字节。ffprobe 确认两者均为单声道 Opus（容器报告 48 kHz 解码采样率，和上游 PCM 16/24 kHz 不冲突）。
- 本地测试回执与音频：`apps/api/.local/voice-smoke/`。真实凭据只存在忽略提交的配置中，上传 Worker Secret 用的临时文件已删除。
- 以上验证的是本机至 Worker 的真实链路；正式国内服务器的 DNS、TLS、WebSocket 线路与持久卷恢复仍需在部署时验收。
