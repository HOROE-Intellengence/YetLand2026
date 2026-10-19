# 社区服务器测试交付 · 2026-10-15

状态：已部署，密码访问与应用链路验收通过。

| 项目 | 实际结果 |
| --- | --- |
| 首页 | https://yetland.cn/，“开始”右侧新增“社区”，浏览器点击跳转通过 |
| 社区 | https://community.yetland.cn/，用户指定密码登录通过 |
| 论坛 | https://forum.community.yetland.cn/，社区体验账号 A 的单次票据登录及浏览器跳转通过 |
| 小手机 | 从社区“进入小手机”实际载入 HTTPS 手机界面；角色、世界书和主题通过手机代理接口读回 |
| 内容 | 本批 24 个可安装资源、8 篇帖子均按原 ID、版本、tid 查询可见；原有内容一并保留 |
| 应用 | 代表性角色、世界书和主题重复安装复用原私有副本；世界书条目完整读回，主题状态读回，账号 B 未变化 |
| 门禁 | 错误密码拒绝；社区、论坛、手机 API 和带参数的 WebSocket 握手未认证均返回 401；Cookie 有 Secure/HttpOnly 标记 |
| 数据 | 原 56 行资源表、66 行版本表、75 行同步表逐行一致；原 487 条审计记录完整保留；SQLite quick_check 为 ok |
| 正式服务 | 正式 API 健康；正式 API、正式小手机、海外 web/phone 和边缘容器 ID/镜像均未更换；仅国内 web 更新 |
| 浏览器 | 首页按钮、密码登录、社区账户、服务器论坛、小手机实际载入；截图位于私有验收目录 |

镜像：

- 国内首页：`yelan-web-caddy:community-entry-cn-20261015`，原 `yelan-web-caddy:admin-voices-cn-20261012` 保留。
- 社区手机：`yelan-phone:community-test-20261015`。
- 桥接与门禁依赖环境：`yelan-api:empty-reply-20261013`，挂载独立社区源码及数据。
- NodeBB：固定 `sha256:471cd975804086ad47f15e10c6c6d9c632721f0c444bf7eb1ce93c2540c4f53e`；Redis 沿用本地镜像。

备份：

- 本地迁移前快照：`D:\YL\.local\community-prototype\backups\2026-10-15T06-18-47-792Z\`。
- 服务器旧配置、容器身份和原始 SQLite：`/root/yelan-community-test-20261015/backup/`。
- 本地上传归档、SHA-256 回执和构建日志：`D:\YL\.server\community-test-20261015\`。
- 接口、数据一致性回执及截图：`D:\YL\.local\community-prototype\server-test\`。

验证范围：门禁单元检查、主站 TypeScript 检查、主站构建范围校验、两个应用构建、32 项线上内容逐项查询、代表性安装及手机接口消费、真实浏览器载入。未运行整套停启论坛运维测试，未调用聊天/语音/生图模型，未新增社区产品功能，未执行 Git 提交或推送。

测试环境仍沿用本地原型的体验身份和界面文案；与正式账号不互通。小手机需要通过社区入口传递短效身份，单独打开手机域名不会自动登录。

回滚命令与重跑说明见 [README.md](README.md)。回滚保留业务数据；若边缘或发布配置已被其他任务修改，脚本会停止，避免覆盖后续变更。
