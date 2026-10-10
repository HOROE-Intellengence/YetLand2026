# 对外 API 网关

本模块独立于原 `/api/chat`、角色库、记忆、侧袋及语音功能。客户端 Base URL 为 `https://ingress.yetland.com/v1`，鉴权为 `Authorization: Bearer <平台签发的Key>`。

## 开通顺序

1. 在既有「API 仓库」确认 Gemini 上游可用。网关默认固定引用 `horoe-gemini-flash-lite`；不会随原聊天主模型切换，也不会自动回退。
2. 打开后台「API 管理 → 调用总览」，选择上游、设置账号额度和并发。当前每 Key 默认每天 100 次、每分钟 20 次、并发 2；账号默认每天 200 次、每分钟 30 次、并发 3。额度按 UTC 日统计，已发往上游的失败调用也计数。
3. 打开「高级版前置」审阅初始草稿，发布后才能使用高级版。初始草稿仅包含 `[全局表达约束前置].md` 中 Boundary 4 之前的一般表达规则；原文件不变，露骨性描写和模式解锁段落未导入。保存草稿不改变线上；每次发布/回滚产生新版本。回滚不覆盖草稿。
4. 在「Key 管理」选择已注册账号，填写必填名称，签发纯净版或高级版测试 Key；复制唯一一次显示的明文。管理员测试 Key 暂保留每账号最多两个未撤销、未过期的限制（停用的也计入），不代表手机号或邮箱已验证。正式用户 Key 按验证码绑定手机号或邮箱全平台唯一，纯净版与高级版共用名额，停用及过期仍占名额；撤销后需重新核验才能申请替代 Key，历史记录保留。Key 仅存 SHA-256 哈希。
5. 「API调用」用户入口可登录后选择邮箱／手机号验证码，填写名称、核验并申请 Key，也可查看／撤销自己的 Key，无聊天历史读取或同步接口。邮箱通过 Bird Verify 接入；仅后端设置 `BIRD_API_KEY`，将示例 `bk_xxxxxxxxx` 替换为真实密钥。本机写入已忽略的 `apps/api/.env`；Compose 部署写入 `infra/deploy/.env` 并重建／重启 API。短信仍为占位，短信发送／核验返回 503。管理员测试 Key 的验证状态为 `admin_test`，不会伪装成已验证。

邮箱申请接口：`POST /api/developer/email/send` 接收 `{ "email": "user@example.com" }`，返回本地 `challengeId`；`POST /api/developer/email/verify` 接收 `{ "challengeId": "...", "code": "123456" }`，返回一次性 `verificationId`；`POST /api/developer/keys` 接收 `{ "name": "客户端名称", "tier": "pure", "verificationId": "..." }`。三步均需账号登录令牌，接收者与账号绑定。Bird 请求固定 `options.language = "zh"`、六位数字验证码，核验需 `success: true` 且收件人和 Bird verification ID 都匹配；HTTP 200 的错误验证码不视为成功。发送后提醒用户检查垃圾箱，说明国际邮件经常被放入垃圾箱中。

邮件发送按账号和邮箱各限每 60 秒一次、每小时五次；最多五次核验尝试，本地挑战有效期不超过十分钟且不超过 Bird 返回的有效期。重发作废旧挑战；核验凭据五分钟内有效，创建 Key 时事务性消费。挑战、限流和核验记录保存在网关 SQLite，重启保留；密钥、验证码和 Bird 错误原文不会返回前端。Bird 请求超时 20 秒、不自动重试。未配置邮件密钥时邮箱入口返回 503。

## 协议

### 用户端额度查询

`GET /api/developer/quota` 使用账号登录令牌 `Authorization: Bearer <登录 token>`，返回当前账号额度；不接受指定其他用户，也不使用平台 API Key 鉴权。响应禁止缓存，查询不消耗额度。`GET /api/developer` 同时包含 `quota` 字段，用户 API 页面展示总额度、已用、剩余及本地重置时间，支持手动刷新。

```json
{"unit":"requests","period":"day","timezone":"UTC","total":200,"used":8,"remaining":192,"resetsAt":"2026-10-01T00:00:00.000Z"}
```

额度为每日调用次数，非余额或 Token 数。账号所有 Key 共用账号额度，各 Key 自身限额仍生效；撤销 Key 不清除已用量。已经受理并落盘的调用（含失败、进行中）计数，鉴权/限流拒绝不计数；剩余最小为 0。没有 Key 也显示账号配额，但仍需有效 Key 才能调用。每天 UTC 00:00 重置。

### 对话接口

- `GET /v1/models` 按 Key 版本列出可用公开模型：纯净版 `yetland_opus_5_5_pure`，高级版 `yetland_opus_5_5_plus`，响应禁止缓存。申请页提供两个模型名的复制按钮；客户端若显示内置模型，请重新获取或手动添加对应名称。
- `POST /v1/chat/completions` 支持 JSON 和 SSE，接受带末尾 `/` 的路径。
- 请求必须包含 `model` 和 `messages`；公开模型名必须匹配 Key 版本，转发时映射到实际配置的上游模型。兼容原上游模型名的旧请求，但模型发现不再展示它。纯净版保留其他请求 JSON 字段和值，不补温度、输出长度、侧袋、角色卡或记忆。鉴权头替换为服务端上游凭证；语义透传，不承诺请求字节格式一致。
- 高级版仅在 messages 开头插入已发布的 system 前置，原消息顺序不变。模型如何处理多个 system/developer 消息取决于上游，提示词不是安全权限边界。
- 额外参数（包括 tools、response_format、多模态 content）保留并由上游决定支持情况。本轮验收覆盖文本、工具增量透传与 SSE，不宣称所有 Gemini 参数已实测。
- 普通响应和 SSE 的顶层 `model` 使用对应公开名称，其他内容（含 usage、tool_calls、finish_reason、[DONE]）保留；内部仍归档原始上游响应。上游错误转换成不含凭证的错误对象。网关不自动重试收费请求，不降级到 mock。
- 请求上限 2 MiB，响应上限 32 MiB，单 SSE 事件上限 4 MiB；总超时默认 180 秒，后台可调。客户端断开取消上游，保留已经收到的部分输出。
- 返回 `x-request-id` 供后台定位；429 另含 Retry-After。无需浏览器 Cookie；浏览器跨域允许范围沿用 CORS 配置，原生/服务端客户端不受浏览器 CORS 限制。

示例（平台 Key 从环境变量提供，不要写入源代码）：

```bash
curl https://ingress.yetland.com/v1/chat/completions \
  -H "Authorization: Bearer $YETLAND_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"model":"yetland_opus_5_5_pure","messages":[{"role":"user","content":"你好"}],"stream":true,"stream_options":{"include_usage":true}}'
```

## 数据归属与留存

### 后台聊天阅读与导出

当前首要分类是**申请 Key 时验证码核验的手机号或邮箱**：聊天侧栏和 Key 管理表格按绑定地址分组，组内显示 Key 名称。支持手机号、邮箱、名称及用户搜索；注册资料不替代验证码绑定地址。管理员测试 Key 单列，不伪装成正式绑定。启动时为旧 `api_keys` 表追加邮箱字段和唯一索引，保留既有手机核验、Key 与调用记录。

「API 管理 → 聊天记录」默认按 Key 汇总，左侧可搜索 Key 或用户，右侧只显示用户/AI 消息。按请求时间排列，每页读取 50 次调用，可加载更早内容。为避免客户端重复携带历史，阅读视图只显示每次请求最后一条 assistant 消息之后的 user 消息及本次实际输出；system、developer、tool 和原始历史仍保存在调用详情。图片、音频、文件显示占位文字，不自动访问外部附件 URL。此视图不新增对话、不改写原始存档。

同一个 Key 可以被多个客户端/会话共用，因此该视图是 Key 时间线，不推断这些请求属于同一个连续会话。若未来需要准确拆分会话，需新增客户端会话标识。

「更多 → 导出当前范围对话」下载纯文本问答；「统计与诊断」保留统计、调用详情和错误，并新增调用与错误 JSONL 导出。普通管理导出包含测试记录，无需训练授权，但不改变训练授权状态；既有训练候选导出仍仅含已获授权的成功记录。管理导出单次最多 1000 次调用，超出会明确报错要求缩小时间范围，不会静默截断。所有读取及导出仅供管理员，写入审计且禁止缓存。

新增管理接口：`GET /api/admin/api-gateway/conversations/:keyId`（from/to/before 游标）；`GET /api/admin/api-gateway/records/export`（from/to/keyId/userId/tier，format=chat 为纯文本，否则为调用 JSONL）。

`apps/api/.local/gateway/api.sqlite` 使用 SQLite WAL/FULL；Compose 挂载到 `infra/deploy/_data/gateway`。这是单进程部署；不要同时启动多个 API 进程共享此文件（启动恢复会标记未完成调用为 interrupted）。多实例上线前迁移协调存储。

- Key 关联稳定 userId，保存注册身份及申请时账号姓名、手机号/邮箱的快照，不保存账号登录 token、密码哈希或上游密钥。新注册账号保存不可变注册身份；旧账号 registration 为空，申请快照只能代表首次签发 Key 时的资料，不能还原其此前被修改过的注册资料。
- 手机和邮箱核验分别建表；短信恢复时记录真实核验凭据、用途和一次性消费，再开放手机自助申请。现有 phoneVerifiedAt 不作为新 Key 的核验凭据。
- 每次调用先事务性预留额度并保存完整请求、实际上游请求、模型及前置版本，再发送上游。响应分段落盘，最终归档状态、耗时和用量；未收到 usage 记未知，不伪造 Token 数。
- 原始身份与对话记录仅在管理员详情可见，详情读取与管理变更有独立审计。普通用户没有云聊天同步能力。
- 请求历史是客户端提供，可能伪造；模型本次输出独立存储。训练导出只包含明确获授权且完成的记录；当前测试 Key 无训练授权，所以导出为空。导出剔除独立账号身份字段，但正文仍可能含个人信息，正式训练前需内容脱敏与样本筛选。最多每次 10,000 条，需按时间分段导出。
- 本版本没有自动删除 API 对话记录，也没有运行任何训练任务。长期留存应监控磁盘并制定保留/删除周期。

备份应使用 SQLite 在线 backup 接口，或停止进程后同时保全数据库及 WAL/SHM；不能在写入中只复制 api.sqlite。管理员恢复后首次启动会将旧 processing 记录标为 interrupted，不补发请求。

## 短信与账号入口

用户申请必须提供名称（去首尾空格后 1–80 字符）、版本及服务端核验凭据 ID。`createVerifiedKey` 预留正式签发路径：只消费属于该登录用户、用途 `api_key`、最近 5 分钟内成功核验且未消费的服务端凭据；规范化大陆手机号为 `+86` 格式，在同一立即事务中检查手机号名额、签发并消费凭据。数据库唯一索引限制每手机号最多一个未撤销 Key，跨账号和版本共用约束；停用/过期仍占名额。失败不消费凭据。现阶段没有写入真实短信核验凭据的入口，用户申请仍返回 503，不能靠提交手机号或伪造凭据 ID 绕过；缺少名称等参数返回 400。纯净版/高级版只能二选一，不能用同一手机号同时申请两版。

短信尚未接入。非单元测试环境的旧 OTP 登录、发送、密码找回、手机号换绑均禁止使用模拟码，注销也不能以任意 OTP 代替密码。已有邮箱/密码和手机号/密码登录保持可用。`.env.example` 保留阿里云配置名但无真实凭证；本模块不发送短信。

## 部署与检查

Caddy 已新增 `/v1/*` 反代和即时 SSE 刷新；现有 `/api/*` 与后台入口继续使用。API Docker 镜像构建时编译新版管理员后台，前端镜像按原方式构建。服务器上需要更新两个镜像和 Caddyfile；本地代码完成不代表域名已经部署。

验证命令（可用原 pnpm 脚本，以下避免包管理器自动安装）：

```text
node node_modules/typescript/bin/tsc -p apps/api/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/admin/tsconfig.json --noEmit
node node_modules/typescript/bin/tsc -p apps/web/tsconfig.json --noEmit
node node_modules/vitest/vitest.mjs run apps/api/src/gateway/gateway.test.ts
node apps/api/node_modules/tsx/dist/cli.mjs apps/api/scripts/api-gateway-smoke.ts
node scripts/check-api-contracts.mjs
```

网关测试使用临时 SQLite 和受控上游，不发短信、不调用收费模型，不改真实账号/Key/前置。

另提供 `apps/api/scripts/api-gateway-live-smoke.ts --confirm-live`，通过同一 tsx 入口显式运行：读取本地已配置 Gemini 凭证，使用独立临时数据库发送两条合成消息（纯净 JSON、高级 SSE），会产生少量上游费用；不创建真实账号或更改正式 Key/前置。不得将此命令加入自动测试或循环重试。

## 本次验收（2026-09-30）

- 网关 21 项测试，以及账号鉴权/邮箱/游客归属相关 34 项测试通过；包括空环境变量、持久化失败、背压期间超时、Key 撤销与额度不重置。
- API、管理后台、用户前端、共享契约类型检查通过；前后台生产构建通过；契约检查无错误（既有 user-character 孤立契约警告仍在）。
- 本机实际 HTTP 测试完成两版各 JSON/SSE 共 4 次，跨账号 Key 访问被拒绝。
- 两次真实 Gemini 合成请求通过：纯净版 JSON 输出 `API_OK`，高级版 SSE 输出 `「API_OK」`，用量与前置版本落盘；测试数据在临时目录，测试 Key 已撤销。
- Docker 镜像构建及容器内隔离 HTTP 测试通过；Compose 配置校验通过。未部署公网域名。
- 本机 8787 后端已重启并验证 `/v1/models` 无 Key 返回 401、后台设置/总览/前置返回 200。正式库初始前置保留草稿，管理员发布后高级版生效；没有签发正式用户 Key。
