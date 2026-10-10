# Yetland 入口页

`public/index.html` 是无外部依赖的页面。中国入口指向 `https://yetland.cn/`，国际入口指向 `https://ingress.yetland.com/`。用户始终手动选择。浏览器请求同域 `/region`，Worker 依据 `request.cf.country` 返回推荐：CN 为中国，其他有效地区为国际，未知不推荐。推荐不代表测速；代理以出口地区为准。接口不返回 IP，不写访问日志，禁止缓存，前端 2.5 秒超时后静默保留双入口。

已部署到 Cloudflare Workers Static Assets：`yelan-portal`，资源目录 `public`，无需构建。自定义域名：`yetland.com`。发布配置为本目录 `wrangler.toml`。

2026-10-10 已将原 `yelan-ingress` 的全区 `*/*` 路由收窄为 `ingress.yetland.com/*` 与 `phone.yetland.com/*`，并同步原 Worker 配置文件。既有 Fish 和 Google Live 专用路由保留，根域由独立静态 Worker 接管。

当前推荐功能版本：`b98f42b3-9a9d-4d16-b17f-986e6d81eae0`；原纯静态版本：`78bc05e1-febb-461e-aead-08859eda6577`。发布前路由备份：`D:\YL\.server\portal-20261010\routes-before.json`。本次未修改应用容器、应用数据或维护状态。

回滚页面可用先前静态资源重新发布。若要恢复原入口拓扑，先解绑根域静态 Worker，再恢复备份中的 `*/* -> yelan-ingress` 路由，最后移除本次新建的两个窄路由；保留语音路由。旧拓扑的根域会返回 421，不能将其视作入口页可用版本。
