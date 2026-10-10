# 国际入口 favicon 更新

- 用户授权读取运维 skill 并操作此前讨论的两个子域：`ingress.yetland.com`、`phone.yetland.com`。
- 采用本机打包发布 Cloudflare Worker `yelan-ingress`，未构建容器镜像、未修改应用服务器或数据、未改变维护状态。国内入口保持原样。
- 新版本：`742a9b4b-3864-4c29-9d43-0e1dcaf49916`。此前版本：`6ac9f782-0761-4c62-9bd4-62ae7d0b468f`。
- 发布前下载线上 Worker 源码到 `.server/favicon-20261010/worker-before.multipart`，与本地 dry-run 打包内容比对完全一致（忽略 source map 注释）。
- 新模块 `infra/deploy/ingress/favicon.mjs`：黑色圆角底 #090b0d、原 Y 形状、暗金色 #B08D45，路径 `/yetland-favicon-gold-v1.svg`。
- 仅对 GET、200、text/html 的页面替换 favicon link。保留 apple-touch-icon、manifest；非 HTML 响应和 WebSocket 保持原处理。SVG 路径由 Worker 返回，不依赖源站新增文件。
- 两个线上首页各有且仅有一个 favicon link，指向新 SVG；两份 SVG 均含暗金色，apple-touch-icon 均保留。未进行完整聊天/语音业务回归，也未将浏览器标签图标视觉标为通过。
- 回滚：使用本机 Wrangler 对 `infra/deploy/ingress/wrangler.toml` 执行 rollback 到此前版本；无需变更 DNS、容器或数据。回滚后同步撤销本次 favicon 模块引用与响应变换，以免下一次部署恢复变更。
