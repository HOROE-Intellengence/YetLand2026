# 夜阑入口实施与验收（2026-10-08）

国内继续用 `https://yetland.cn`，手机用 `https://phone.yetland.cn`；海外或全局代理改用 `https://ingress.yetland.com`，手机由主站打开 `https://phone.yetland.com`。公网维护页继续保留。海外密码预览页为 `https://ingress.yetland.com/__preview/login`，使用现有测试入口文件中的凭据，凭据不写入本文。

## 原因与方案选择

国内直连的 DNS、TLS 和预览 API 正常。当前全局代理使用美国住宅出口；原域名、固定原服务器 IP 都在 TLS ClientHello 后收到明文 HTTP 403，因而客户端报告 TLS token/version 错误。服务器抓包未见该海外出口到达应用服务器，UFW 未开启、INPUT 接受；不能据此断言已独立排除阿里云网络层限制。确定的是失败发生在应用 TLS/登录之前，不能归咎于 Fish/语音中继出站。

进一步实测：`global.yetland.cn`、`phone-global.yetland.cn` 的 SaaS 证书、域名状态都 Active，DNS 指向真实 CF 接入目标；但当前海外代理对这两个 `.cn` 域名仍在 TLS 前失败。使用解析返回的 CF IP 固定访问亦失败，`.com` CF 入口成功。证据指向当前代理链路按域名或 SNI 区分的阻断，具体代理提供商、中间设备或规则未能确定。这个代理问题不能只靠同域名换 DNS 解决。

| 方案 | 费用与支持 | 准确性与维护 | 国内影响 / 结论 |
|---|---|---|---|
| 阿里云地域 DNS + CF SaaS 同域名转发 | 阿里免费地域一级分类有中国/境外；SaaS 首 100 个自定义主机名免费，超出每个 $0.10/月。要先接入主机名、颁证，再使用官方 CNAME | 依赖 LocalDNS 出口地域，代理出口与 DNS 出口可能不一致；同域名编译配置较少 | 理论上可保留国内 A，但当前代理连 CF 上的 `.cn` 也阻断，所以本任务不切换原域名 |
| 保留国内域名 + 专用 `.com` CF 备用入口（已实施） | CF Free + Workers Free，当前新增月费 $0；Worker 免费账户共享 100,000 请求/日，超额报错，未升级付费。域名注册已由用户完成，官方 `.com` 当前注册/续费标价 $10.46/年，实际账单以用户订单为准 | 明确选择入口，避免地域误判；需维护两套前端构建配置 | 原主站、手机直连不变，推荐 |
| 标准 CF Partial CNAME 接入 | 仅 Business/Enterprise 支持；Business 当时官网 $250/月或年付折合 $200/月 | 官方受支持，但成本明显高 | 不符合优先免费，不选 |

免费 DNS 的地域分类不等于免费海外 DNS 节点加速；不保证所有代理和国家都能访问。

## 实际配置

- 阿里云原 `@`、`phone`、`www` A 仍为 `8.134.151.88`，TTL 600。原 NS 未变。
- 曾新增 `global`、`phone-global` CNAME `ingress.yetland.com`，TTL 600；SaaS 两个证书 Active（当前到期显示 2027-01-06）。这两个 `.cn` 地址不作为本次已通过的海外入口。
- 专用 `yetland.com` 注册在 Cloudflare，Full / Free，NS `luciana`、`phil`。个人 `clarklin.com` 未修改。
- `ingress`：AAAA `100::`、Proxied、Auto；`phone`：CNAME `ingress.yetland.com`、Proxied、Auto。`100::` 是官方 Worker-as-origin 无源站占位设置，不是任意 CF IP。
- 已验收的 `.com` 入口属于 CF 本区代理，运行不依赖 SaaS 自定义主机名；先前开通的 SaaS 和两个 `.cn` 主机名仍在免费额度内，作为探索配置保留，不推荐给当前代理使用。
- Worker `yelan-ingress`，`*/*` 路由仅挂在专用 `yetland.com` zone；关闭 workers.dev、预览 URL、请求日志。严格白名单映射：主站回 `https://yetland.cn`，手机回 `https://phone.yetland.cn`，保留 HTTPS 证书验证，无手工修改 SNI，无明文回源。
- Worker 去掉客户端伪造的入口/转发地址头，注入私密入口令牌。维护代理同时要求入口令牌、指定域名和已有预览 Cookie，才访问备用前端；身份鉴权仍由 API 校验 Bearer。
- HTTP 自动跳 HTTPS（证书校验路径除外）；密码表单调用同源现有 Basic 入口，保持原认证机制。`.com` 的预览 Cookie 转为 `Domain=yetland.com; Secure; HttpOnly; SameSite=Lax`，主站和手机共享预览权限。账号令牌由主站向匹配的手机 iframe 传递，不跨 `.cn` 与 `.com` 共享 localStorage；换主站入口要单独登录。
- 前端源码以已部署 c68ffa1 为基线，主站 `WEB_API_BASE=https://ingress.yetland.com`、`WEB_PHONE_URL=https://phone.yetland.com`；手机 `NEXT_PUBLIC_YELAN_WEB_ORIGIN=https://ingress.yetland.com`。两端都重新构建，原国内前端保留。
- API 镜像保持 `yelan-api:phone-20261007-2f13d36`。仅改 `CORS_ORIGINS` 为原主站加 global.cn 和 ingress.com，`VOICE_ASR_PUBLIC_ORIGIN=https://ingress.yetland.com`；签名密钥及其他配置保持一致。旧签名链接可能在 15 分钟有效期内受源地址切换影响。
- 手机 CSP `frame-ancestors https://ingress.yetland.com`。CORS 允许新主站，未知来源不返回 Allow-Origin。
- Worker 所有响应及内部代理 private/no-store，CF Cache-Status 实测 DYNAMIC；登录、API、音频和私有内容不缓存。POST 不自动重试，避免重复收费。
- 图片 POST 等待上游时立即发送 JSON 空白并每 15 秒心跳。开始发送后 HTTP 为 200，实际错误状态放进带标志的 JSON；客户端识别 401/403/429/502 等，正常图片/base64 内容保持完整，取消会终止回源。其他 API 不受此处理影响。
- 新增镜像 `yelan-web-caddy:ingress-20261008-com`、`yelan-phone:ingress-20261008-com`；项目 `yelan-ingress` 只连内部 `yelan-release_web`，没有新增主机端口。

## 实测与边界

| 检查 | 结果 |
|---|---|
| 国内原主站、手机 | 匿名维护 503，预览 200，合成账号鉴权 200 |
| 美国海外全局代理 `.com` 主站、手机 | 维护 503、预览 200、身份 200、缺 Bearer 401、匿名 API 503、手机 bootstrap 200 |
| CORS / CSP | 允许入口 OPTIONS 204 + 正确 Allow-Origin；未知来源无 Allow-Origin；手机 CSP 父源正确 |
| HTTPS 密码验证 | 无密码 401、正确密码 303；Set-Cookie 域名改为 yetland.com；内置浏览器不支持 Basic 弹窗，新增页面表单 |
| SSE / WebSocket | 最终 phone.com 入口经全局代理 WS 回声通过；SSE 3 次心跳约 48 秒完成（合成私有探针） |
| 长图片传输 | 使用同一已部署心跳模块的合成 180 秒等待，经全局代理 phone.com 约 183.2 秒完整完成；实际图片接口空请求返回标记 HTTP 200 + 业务 400，被客户端识别 |
| 超时负面对照 | 无心跳 CF 回源约 128 秒 524；当前海外代理静默请求约 64 秒断开 |
| HQ ASR 链接 | 新 `.com` 签名链接经海外代理，无登录 Cookie 读取 200/8824 字节，HEAD 200/0 字节，Range 206/32 字节，篡改签名 403；全部 no-store |
| 源码与构建 | 9 项针对性心跳/错误/取消测试通过，手机 tsc 通过，两个生产镜像构建成功，git diff --check 通过 |
| 浏览器主站与 iframe | `.com` 密码表单进入预览成功；未登录手机入口要求账号登录；合成账号登录后，iframe src 为 phone.yetland.com，欢迎页和完整桌面均已读取并截图。托管入口只有通过父源校验、收到令牌并完成 /auth/me 后才加载手机应用，握手通过 |

所有数据用已有 `@example.test` 合成账号和合成音频；没有发送真实聊天、调用付费生图/模型或做 Fish/ASR 厂商转录。WS/SSE 为入口传输探针，不声称真实语音服务、实际聊天模型调用已成功。物理手机、更多国家/代理尚未覆盖。探针容器及其公网路由已移除。

内置浏览器的 iframe 点击自动化发生超时，但最终可视读取确认完整桌面已进入。浏览器保留测试预览与合成账号登录会话，供用户继续验收。服务器 API healthy，备用前端总内存约 109 MB；可用内存约 2.4 GB，磁盘约 50 GB 剩余。

## 回滚

原配置与全量数据备份在服务器 `/root/yelan-ingress-20261008/backup/`，含 Caddyfile、deploy.env、发布 Compose 和冷备 `api-data.before-ingress.tgz`。备份 tar 可读，SHA256 `9ade4733a45ab4aee08032863718f83ba0a7fc952c654a91a33ef26b27c63830`。原镜像保留，旧版 `yelan-api` 已从原 inspect 备份恢复且保持停止。

入口问题回滚命令（Windows SSH）：

```powershell
ssh yelan-server 'python3 /root/yelan-ingress-20261008/rollback.py'
```

脚本核对 `yelan-release` 项目，验证原 Caddy，恢复原维护配置和原 API 环境，以同一 API 镜像重建，停止两个备用前端。**不会恢复或覆盖用户数据，不撤维护页。**脚本已准备并通过语法检查，没有执行回滚演练。

Cloudflare 侧可在专用域名的 Worker Routes 移除 `yelan-ingress` 路由，并删除本次新增 DNS；阿里云只删除 `global`、`phone-global` 两条新增记录，原 `@`、`phone`、`www` 不改。DNS 回收等待原 TTL 600 秒。SaaS 可移除两条自定义主机名；不影响个人域名。

更新 API 环境时曾漏指定 Compose 发布项目名，命名冲突导致一次更新失败；已立即恢复原运行 API、改用明确 `-p yelan-release`，随后更新成功。旧版停止的回滚容器亦按原镜像、环境、挂载恢复，并清理了错误项目的未运行容器。

## 资料与证据

- [阿里智能解析](https://help.aliyun.com/zh/dns/pubz-intelligent-analysis)、[智能解析 FAQ](https://help.aliyun.com/zh/dns/pubz-intelligent-parsing-related-faq/)
- [CF SaaS 费用](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/)、[Worker 回源正式支持](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/)
- [CF Partial 适用计划](https://developers.cloudflare.com/dns/zone-setups/partial-setup/)、[Worker 免费限制](https://developers.cloudflare.com/workers/platform/limits/)、[Registrar 价格](https://pricing.registrar.cloudflare.com/)
- 本地 `.server/ingress-20261008/final-check.json`、`transport-test.json`、`dns-com-active.jpg`、`saas-active.jpg`、`phone-desktop-accepted.jpg`；目录被 Git 忽略，凭据与签名 URL 不进入本文。
