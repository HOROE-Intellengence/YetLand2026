# share（长图分享子站）

> 占位。Phase 1 W10 起开发。

## 目标

KOC 用的长图导出能力（开发文档 §四.7）：

- 适配小红书 1080px 宽
- 深色背景 + serif 字体 + 自然段分隔
- 仅导出主线，不导出 IF 线
- 弱水印「夜阑」，不出现强营销二维码

## 选型（建议）

- Next.js（SSR 渲染长图后用 `@vercel/og` 或 puppeteer 截图）
- 与主前端独立部署在 share.yelan.app

## 数据流

`apps/web` 用户在记事面板选择"导出本段" → 跳转 share 子站，传 sessionId + 段落范围 → share 子站调 server `/api/sessions/:id/messages` → 渲染 → 截图 → 下载
