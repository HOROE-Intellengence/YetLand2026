# 社区资源自动预览发布记录

发布完成：2026-10-19 01:37:59 UTC（纽约时间 2026-10-18）。入口：[夜阑社区](https://community.yetland.cn/)。本次由用户明确授权线上发布，按 `yelan-ops` 运维流程执行。

## 交付行为

- 资源列表自动生成内容缩略图，详情无需安装即可查看。
- 角色卡展示作者提供的人设、背景、关系和开场动作。
- 世界书展示条目数量、常驻/关键词分类，支持展开完整内容和触发词。
- 手机主题使用资源实际色值生成桌面、聊天示意，可切换场景；页面说明示意边界和默认颜色回退行为。
- 预览直接从已发布版本的数据生成，无需贡献者制作截图，不调用模型。保留原有访问门禁与账号权限；预览不安装资源、不更改当前主题。
- 本次未增加投稿表单中的实时预览。

## 发布范围与镜像

本机 Docker 基于线上现用镜像构建增量镜像，随后上传服务器加载；没有在服务器构建，也没有打包整个工作区。

| 项目 | 值 |
| --- | --- |
| 新镜像 | `yelan-api:community-previews-20261018` |
| 新镜像 ID | `sha256:3b253717a20bd1aa5938b6ac1da66bdaddf3e44f45c7a2b1db2f752454e035c4` |
| 基础/回滚镜像 | `yelan-api:community-account-20261015` |
| 基础镜像 ID | `sha256:1b765b3006009cbbd4e2de8ceed63cef6cf2718e5ffe3cbdbfe630d86c599b7c` |
| 上传归档 SHA-256 | `c444038e641d368988018bda78bb3edec009ee8d249e28ccffbb5e9ffa8ef525` |
| 替换容器 | `yelan-release-api`，同时承载主 API 与社区 API |
| 远端发布目录 | `/root/yelan-community-previews-20261018` |

只覆盖以下六个运行文件，容器内已逐项核对 SHA-256：

1. `apps/api/src/community-prototype/application.ts`
2. `apps/api/src/community-prototype/preview.ts`
3. `prototype/community/public/app.js`
4. `prototype/community/public/index.html`
5. `prototype/community/public/previews.js`
6. `prototype/community/public/previews.css`

`index.html` 从线上基线增加两个预览资源引用，未带入本地另一个任务的侧栏 SVG 改动；未发布 `style.css`、小手机或其他工作区变更。Compose 仅修改 API 镜像，其他容器 ID 保持一致，旧独立社区桥接 API 继续停止。

## 备份与数据核对

备份目录：`/root/yelan-community-previews-20261018/backup`，仅供运维访问。

临时维护期间停止共享 API 写入，归档正式 `_data` 和社区共享状态目录（含 SQLite WAL），逐字节读取压缩归档验证可读性；保存论坛 Redis RDB、现有论坛文件及 Compose、环境、门禁、边缘代理配置。散列回执为 `backup/checksums.json`。没有执行全量恢复演练。

部署后 917 个用户、103 个角色字段核对一致，模型与图像配置未变。下表所列数据在发布前后行数及完整表内容散列一致：

| 表 | 行数 |
| --- | ---: |
| community_resources | 56 |
| community_revisions | 66 |
| installations | 32 |
| community_assets | 26 |
| community_bindings | 9 |
| community_theme_state | 6 |

恢复了发布前的边缘代理运行配置，持久 Caddyfile 未变，原有维护/门禁策略保留。

## 实际通过的验收

- 本地 6 项预览单元测试及 API TypeScript 检查通过。
- 经过公网 HTTPS 和正常门禁认证，29 份已发布资源返回当前版本预览，响应禁止缓存；27 份草稿/下架资源返回不可访问。
- 未认证的社区、论坛、小手机接口（含新预览接口）仍受门禁保护；门禁认证未获得用户私有资源的账号权限。
- 四个前端发布文件与本机待发布文件逐字节一致。
- 主站恢复可访问；主 API 与社区 API 健康检查通过。
- 本轮线上浏览器实际打开“工具借阅员 · 殷禾”，显示人设、背景、关系和开场动作。
- 本轮线上浏览器实际打开“白帆潮湾测绘册”，显示 10 条设定、2 条常驻、8 条关键词；点击“盐尺站,刻度尺”后，触发词和正文正确展开。
- 本轮线上浏览器实际打开“靛夜航线”，桌面使用实际主题颜色；切换聊天后选中状态和聊天示意正确显示。

本轮没有调用真实模型、安装新资源或进行真实对话效果测试。自动预览为内容展示和主题示意，主题示意并非小手机运行时截图。

私有证据：远端 `deployed.json`、`verification.json`、`manifest.json`、`backup/checksums.json`；已取回本机 `.server/community-previews-20261018/`。线上页面截图在本机 `.local/community-prototype/preview-release-20261018/`。

## 回滚

以下为需要回滚时执行的命令，本次未执行：

```powershell
ssh yelan-server python3 /root/yelan-community-previews-20261018/deploy.py rollback
```

脚本先核对 Compose 发布配置及持久边缘配置未被后续修改，再将 API 恢复到原镜像，保留现有用户数据，不回灌发布前的数据快照。后续若已发布其他版本，散列保护会拒绝覆盖，需先重新核对。旧镜像及本次备份均保留。
