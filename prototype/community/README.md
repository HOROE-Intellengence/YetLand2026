# 夜阑社区本地原型

独立运行真实 NodeBB，并复用夜阑现有的邮箱登录、角色创建和权限逻辑。

```powershell
node prototype/community/start.mjs
```

- 资源社区入口：http://localhost:3038
- 资源列表按类型展示内容缩略图；无需登录或安装即可打开预览。角色卡展示作者的人设、关系与开场动作，世界书可展开完整条目和触发词，手机主题可切换桌面/聊天配色示意。预览不修改角色库或当前主题。
- NodeBB 论坛：http://localhost:4567
- 从资源页的“社区讨论”进入论坛，会使用一次性票据自动登录。
- 论坛顶部的“返回夜阑社区”可直接回到资源社区，同一窗口跳转。
- 右上角“本地体验账号”提供成员 A、成员 B、版主和管理员四种体验身份；也可注册本地邮箱账号。
- 成员可发布角色卡、世界书和小手机主题（含 JSON 导入）、保存草稿、提交审核、发布新版本和下架自己的资源。
- 版主可审核资源及论坛帖子；管理员可管理账号状态、分配角色、查看审计和处理同步任务。
- 资源审核通过后才同步论坛，成功后上架。可把本人在资源版块的帖子转为资源，保留原帖和回复。
- 资源下架会隐藏关联帖子并阻止新安装；论坛主帖修改或删除会使资源下架并要求重新审核。用户已有私有副本保留。
- 更新是独立版本，不覆盖已安装的私有副本；重复安装同一版本复用角色。
- 夜阑侧是唯一账号来源，论坛独立注册和密码登录已关闭。两端退出、账号切换、封禁、注销和权限变化统一校验，已有 WebSocket 也会校验会话。
- 社区昵称同步至论坛。论坛账号设置返回社区修改，论坛后台可从管理员工作台进入。
- 角色卡点击应用后，实际写入隔离的夜阑账户库；重复应用复用已有角色。
- 世界书安装时选择自己的私有角色，条目写入该角色现有的 `phoneRules.worldBook`；可从“我的资源”绑定或解绑，保留其他设定、预设、正则及手动改写过的条目。相同条目在多个包版本间共享时，最后一份绑定解除后才移除。
- 主题保存到账户资源库，支持配色、字体和内嵌 PNG/JPEG/WebP 壁纸；启用、切换版本、恢复均从“我的资源”操作。重新进入小手机生效，恢复时保留用户后来修改过的配色与图标。
- 左侧“进入小手机”打开真实 Next 小手机服务（3041），复用现有主题存储、世界书绑定和提示词组装。手机浏览器数据按账号隔离，短效会话在社区退出后失效。本地不提供模型回复。
- 两份原官方预览自动经带审计的同步队列升级至 `1.0.0`，保留原帖子；用户投稿、下架状态和历史版本不覆盖。
- 示例内容是专为原型编写的演示素材，没有采集外站内容。
- 数据、会话密钥、安装记录位于 `.local/community-prototype/`，不进入 Git。
- 不接入付费模型，不连接生产账户，不自动执行机器人任务。

首次启动需要 Docker Desktop，并下载 NodeBB 镜像。启动器只启动本原型的容器。

启动器还会启动本机隔离的小手机进程，使用现有 `ai-virtual-phone/node_modules`。单独启动：`node prototype/community/start-phone.mjs`；只启动社区：`node prototype/community/start.mjs --no-phone`。手机日志为 `.local/community-prototype/phone.log`；3041 仅监听本机，使用独立 Next 构建目录，不连接生产服务。

本机复用已有 `yelan-api:empty-reply-20261013` 镜像作为依赖环境，源码以只读方式挂载；账户、论坛、资源库三项服务均由本原型的 Docker Compose 管理。界面和论坛端口仅绑定本机，登录票据交换接口只在容器网络内开放。

停止：`node prototype/community/stop.mjs`。停止保留数据库和已安装的角色卡。

验收：

```powershell
node prototype/community/check.mjs
node prototype/community/check-lifecycle.mjs
node prototype/community/check-operations.mjs
node prototype/community/check-assets.mjs
node prototype/community/check-previews.mjs
docker exec yelan-community-prototype-nodebb-1 node /usr/src/app/node_modules/nodebb-plugin-yelan-local/check-sockets.cjs
```

`check-operations.mjs` 会短暂停启本原型的 NodeBB 容器，验证中断恢复。测试只使用本地体验和临时验收账号，结果保存在 `.local/community-prototype/*report.json`。

发布同步最多自动尝试 5 次，失败后可手动重试或取消未完成的发布任务；取消会保留审核与操作记录。账号停用先在账号库生效，论坛 HTTP 和 WebSocket 每次操作均回到账号库校验，桥接异常时拒绝继续操作。

安装包示例见 `examples/rain-city.worldbook.json` 与 `examples/quiet-moss.theme.json`；字段校验以 `packages/shared/src/contracts/community-resources.ts` 为准。主题为声明式配色、字体、壁纸包，不支持任意 CSS、远程资源地址或原第三方 ZIP 主题包。单个壁纸 data URL 最多 80,000 字符，整个投稿接口仍有 100 KB 上限。角色世界书最多 100 条，绑定前校验，不截断用户内容。

本轮仍为本机原型：三种资源均可应用至隔离账户，小手机使用真实消费者代码。尚未连接正式主站账户与导航、真实模型聊天、外站采集或机器人运营，也未接入邮箱验证、找回密码和生产备份运维。世界书作用于小手机角色规则，不改主站聊天的全局设定。演示管理员入口只适用于本地体验，不能原样上线。
