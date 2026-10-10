# Yetland 导航页部署 — 2026-10-10

## 后续：IP 地区推荐已上线

- 版本 `b98f42b3-9a9d-4d16-b17f-986e6d81eae0`，新增同域 `/region` Worker 逻辑和入口下方小字「推荐」。大陆 CN 推荐中国，其他有效地区推荐国际，未知及异常不显示推荐。无自动跳转，未改入口地址和现有业务路由。
- 请求只使用 CF 提供的 country 元数据，不接受客户端自报地区，不返回 IP；接口 private/no-store，前端 2.5 秒超时。
- 六个本地分类案例及禁止缓存断言通过。线上国内服务器返回 `china` / 200，本机代理返回 `international`。线上 HTML 与本地更新文件校验一致。
- 内置浏览器刷新仍超时，未完成此次标记的线上视觉验收。
- 可回退纯静态版本 `78bc05e1-febb-461e-aead-08859eda6577`，不需要更改 DNS 或路由。

## 初次上线记录

- 前端已由用户确认：仅 Yetland 品牌和中国、国际两个链接，无自动探测或自动跳转。
- 正式地址：https://yetland.com/ 。中国：https://yetland.cn/ ，国际：https://ingress.yetland.com/ 。
- 本机发布静态文件到 Cloudflare Workers Static Assets，Worker `yelan-portal`，版本 `78bc05e1-febb-461e-aead-08859eda6577`。未重建或更新应用服务器。
- 自定义域名 API 确认 enabled，service 为 yelan-portal，production 环境。
- 原全区 `*/* -> yelan-ingress` 改为两条精确主机路由：`ingress.yetland.com/*`、`phone.yetland.com/*`。先新增窄路由，再删除全区路由。Fish 与 Google Live 专用路由原样保留，并已回读确认。
- 路由备份：`D:\YL\.server\portal-20261010\routes-before.json`；回滚步骤见 `infra/deploy/portal/README.md`。

## 验证

- 本机经代理：根域、国际主站、国际手机入口均 HTTP 200。
- 线上根域 HTML SHA256 与用户通过的本地页面相同：`C15CF8BCAFD0903F8C03580B5360577534D2BEB65A14609B1B1B801A93273AA0`。
- 国内 yelan-server 发起 HTTPS 请求：yetland.com 与 yetland.cn 均 HTTP 200。
- 发布前本地浏览器视觉已通过；发布后内置浏览器连续两次超时，未宣称正式域名浏览器视觉验收完成。
- 未覆盖国内移动、联通、电信真实终端；未回归登录、聊天、语音或手机完整业务。HTTP 200 不等于这些业务全部通过。

## 变更边界

仅新增静态导航 Worker、自定义根域和收窄原 Worker 路由；未改国内域名、语音路由、应用数据、容器或维护状态。Wrangler 现有 OAuth 经正常刷新恢复使用，未创建或展示密钥。
