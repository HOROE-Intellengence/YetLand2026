# 社区小手机回复引导部署记录

部署完成；最终服务器复核时间：2026-10-16 02:28:18 UTC（纽约时间 2026-10-15 22:28:18）。

## 变更与范围

每个聊天首次出现角色回复、且回复生成结束后，在聊天界面显示暗幕，镂空高亮右下角星星，并提示“点击✨触发回复”。点击原星星仍走原回复逻辑，同时关闭引导；点击暗幕或按 Escape 也可关闭。关闭状态按聊天保存，后续轮次不重复，新聊天独立计算。

仅部署社区手机服务 `community-test-phone`，Compose 项目 `yelan-community-test`、服务 `phone`。实际消费者为社区弹窗中的 `https://phone.community.yetland.cn`。本次只向现有线上手机源码叠加以下三个文件的变更，本地预览测试面板未打包：

- `ai-virtual-phone/components/chat/chat-room.tsx`
- `ai-virtual-phone/components/chat/chat-reply-guide.tsx`
- `ai-virtual-phone/styles/chat.css`

## 构建与版本

在本机 Docker 构建 Linux amd64 镜像，上传压缩归档并核对 SHA256 后加载；先启动无公网端口的候选容器验收，再仅替换社区手机容器。候选容器已清理。

| 项目 | 值 |
| --- | --- |
| 新镜像 | `yelan-phone:community-reply-guide-20261015` |
| 新镜像 ID | `sha256:95dd444349a222ac686a1e70076aead16dbca4a28761525348b323075f65a322` |
| 原镜像 | `yelan-phone:community-test-20261015` |
| 原镜像 ID | `sha256:832f571ad7fa8610b9379b6dface5d636ef5f89845dad430ad6feb2ccb29459d` |
| 线上 Compose | `/root/yelan-community-test-20261015/compose.yml` |
| 发布记录目录 | `/root/yelan-community-reply-guide-20261015` |
| 本机发布材料 | `D:\YL\.server\community-reply-guide-20261015` |

现有工作区包含其他未提交变更；本次未提交 Git，也未将其他工作区变更带入镜像。

## 已通过的验证

- TypeScript 检查、`git diff --check`、Next.js 生产构建通过。
- 本地使用真实组件与聊天样式验证：首轮后出现、点击星星仅触发一次并关闭、后续轮次不重复、聊天分别计数、缩放定位、刷新后的关闭状态保存。
- 候选容器和最终线上容器均通过 `/api/community-prototype-health`；原型标记为 `yelan-community`，手机根页面 HTTP 200。
- 线上资源包含提示文字的 JS 和镂空高亮 CSS；扫描确认不含预览控制面板。三个源码文件 SHA256 与本机发布源一致。
- 社区正常登录后，小手机弹窗与真实手机桌面可加载。
- 其他九个容器的 ID、镜像与运行状态均与部署前一致；入口配置未改，现有维护状态保留。
- 数据备份归档 SHA256 在最终复核时再次校验通过。

首次部署时，自动化工具对跨域嵌入手机出现点击坐标偏移、输入焦点失效和超时，未能完成线上点击验收。2026-10-15 晚用户要求浏览器内测后，已使用社区真实弹窗及合成账号“社区联调A”补充验收：

- 从桌面角色入口选择许照并建立真实会话，发送合成测试消息。
- 点击星星取得首轮角色回复后，实际画面出现暗幕、右下角星星镂空高亮和“点击✨触发回复”。
- 以手机 DOM 的 `elementFromPoint` 检查星星中心，命中原星星按钮；高亮中心与按钮中心在当前缩放下偏差约 0.004 CSS 像素。
- 点击原星星按钮后，引导立即消失，并进入回复生成；下一轮完整回复“台子上的星图看清了吗？”显示后，引导没有再次出现。
- 再发送“星图上的方向我看清了，接下来先看哪一处？”：发送后保持等待，点击星星后开始生成，完整回复显示，仍未重复出现引导。
- 关闭社区手机弹窗后重新进入，iframe 重新加载（loader ID 已变化），再从聊天列表打开许照：历史消息保留，六条角色消息可见，引导保持关闭。本次未修改代码或再次部署。

浏览器工具的普通坐标、键盘及框架定位操作在该跨域 iframe 中失效；补充验收通过工具提供的 CDP 能力，在 iframe 独立上下文内对当前可见的真实 DOM 按钮执行点击、填写真实输入框。没有替换页面、注入模拟聊天、设置组件状态或修改线上代码。星星镂空另做真实 DOM 命中检查；这与物理鼠标完整点击验收分开记录。测试中未使用真实用户聊天。后续真实回复内容不属于本次引导功能的角色设定质量验收。

截图与记录位于本机发布材料目录：`live-guide-visible-20261015.png`、`live-second-reply-20261015.png`、`live-reloaded-chat-20261015.png`、`live-trigger-check.json`、`live-next-message-check.json`、`live-reload-check.json`、`live-completed-round.txt`。

结论：线上真实页面的首轮引导、原按钮命中、点击关闭及触发回复、后续消息手动触发回复、后续不重复、重载后保持关闭均已取得浏览器证据。尚未补测的线上分支为新聊天独立计数、点击暗幕关闭和 Escape 关闭；这些分支此前在本地验证通过。

## 备份与回滚

服务器备份：`/root/yelan-community-reply-guide-20261015/backup/`，保留原 Compose、入口 Caddyfile 及数据快照。

数据归档 `backup/data.tar.gz`：103400144 字节；SHA256：`759fbbfb71a944acf695e4c9f97031b40989bdf2945a423c5bf9946e5f61c5f2`。包含现有 API 数据目录和社区状态目录；六个 SQLite 数据库使用在线 backup API，并分别通过 `quick_check`。各数据库分别取快照，不宣称跨库事务一致。

只回退社区手机镜像与配置，保留当前业务数据：

```powershell
ssh yelan-server python3 /root/yelan-community-reply-guide-20261015/deploy.py rollback
```

回滚脚本要求当前 Compose 和手机镜像仍匹配本次部署；如已有后续发布则拒绝自动覆盖。原镜像保留。回滚脚本已保存，本次未执行回滚演练。

部署证据：发布目录内 `preflight.json`、`deployment.json`、`final-verification.json`，本机保留副本。
