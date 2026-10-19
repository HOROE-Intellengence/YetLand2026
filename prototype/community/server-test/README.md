# 社区隔离服务器测试

2026-10-15 首次将本地原型部署为密码保护的服务器测试环境。随后按用户授权完成正式账号、资产归属和现有模型对话接入，账号架构见 [统一账号验收记录](account-integration-20261015.md)。2026-10-18 已上线资源自动预览，最新镜像、验收和回滚方式见 [自动预览发布记录](../../../docs/community-resource-previews-deployment-20261018.md)。下文保留首次隔离部署过程，不代表最新账号架构；不要直接重跑旧部署脚本覆盖当前统一账号服务。

- 主站入口：https://yetland.cn/，桌面导航“开始”右侧为“社区”，移动端导航菜单也包含入口。
- 社区：https://community.yetland.cn/
- 论坛：https://forum.community.yetland.cn/，从社区进入可传递账号身份。
- 小手机：https://phone.community.yetland.cn/，必须从社区“进入小手机”进入。
- 访问密码由用户指定，仅以 scrypt 盐和散列存入私有配置；源码、镜像、报告不包含明文密码。
- 三个测试域名共用 12 小时的 Secure、HttpOnly、SameSite=Lax 门禁 Cookie。未认证的接口、WebSocket 握手均被门禁拦截。社区身份 Cookie 仅限 community.yetland.cn 及其子域，不发送到正式主站。

## 文件与数据

服务器目录 `/root/yelan-community-test-20261015`，Compose 项目 `yelan-community-test`。五个容器仅在独立 Docker 网络内暴露服务，未发布宿主机端口；现有 Caddy 边缘代理加入该网络。普通容器重启会保留网络，若重新创建边缘容器，需要再次执行 `docker network connect yelan-community-test yelan-maintenance`。

本机打包区 `.server/community-test-20261015/`，私有验收回执与截图 `.local/community-prototype/server-test/`。两者均已被 Git 忽略。服务器 `secrets/gate.json`、`.env`、`data/state/runtime.json` 为私有文件，禁止提交。

`data/` 包含复制的隔离账户、SQLite 资源库、Redis 论坛库、NodeBB 配置、附件和构建产物。复制保留资源 ID、作者、审核、版本、论坛 tid 及用户私有副本；仅改运行域名、桥接密钥和论坛会话签名密钥。历史帖正文保持原样，渲染时适配本地资源链接，避免直接编辑关联主帖导致下架。

## 构建与部署

这些脚本固定用于本次发布目录，重复执行会先检查已有文件、数据及配置，不覆盖已恢复的业务数据。

1. 本地 `backup.mjs` 位于 `../content/batch-20261015/`：在线 SQLite 备份、Redis SAVE 和四项论坛数据归档，不停止服务。
2. `prepare.mjs` 复制隔离服务源码并生成 Dockerfile。`check-web-scope.mjs` 使用已部署共享契约快照验证：撤掉两处首页源文件改动后的 JavaScript 与已部署产物字节一致，然后构建仅含入口改动的首页。该脚本依赖打包区 `deployed-shared/` 和已归档的旧版 web 产物，缺失时必须先提取，不能跳过检查。
3. 本机构建 `Dockerfile.web` 与 `Dockerfile.phone`。小手机沿用现有锁定依赖，复用 API 镜像中的 zod 3.25.76；不升级依赖。Next 构建沿用项目跳过类型/lint 的配置，不能将编译成功称为全量类型检查通过。主站另行执行 TypeScript 检查已通过。
4. `package.mjs` 默认打包一次初始数据快照；`--infra-images`、`--phone-image` 打包镜像；`--source-update` 打包最终源码修正。每个包都带 SHA-256 回执。Linux 构建卷的符号链接保持在原 tar 中，到服务器后解包。
5. 通过既有 SSH 别名 `yelan-server` 上传归档、回执和 `deploy.py`。服务器执行 `python3 deploy.py prepare`，校验散列、备份原边缘/发布配置、只恢复一次数据并启动社区基础服务。最终源码包在初始快照之后覆盖代码；有源码包时重新编译论坛客户端。
6. `python3 deploy.py phone` 加载并启动独立小手机；`python3 deploy.py edge` 校验后热重载三个测试域名。验证成功后，`python3 deploy.py web` 仅更换正式站 web 容器。正式 API、正式小手机和海外入口不更换。

## 验收与回滚

- `node --test prototype/community/server-test/access-gate.test.mjs`：密码、共享子域会话、CSRF、伪造会话、限流及带查询参数的请求。
- 在进程环境中安全设置 `COMMUNITY_TEST_PASSWORD` 后运行 `node prototype/community/server-test/verify-server.mjs`。它使用正常登录和安装接口，核对 32 个实际论坛主帖、资源 ID/版本/链接、代表性重复安装、手机条目与主题读回、账号隔离和论坛票据；最后恢复原主题。回执及令牌仅写 `.local`，不要将该环境变量保存进可提交文件。
- `inspect-deployment.py` 在服务器比较初始快照与当前资源、版本、同步表及原有审计记录，并确认正式服务容器未更换、测试容器没有公开端口。
- 回滚：`ssh yelan-server python3 /root/yelan-community-test-20261015/deploy.py rollback`。配置有后续修改会拒绝自动回滚；正常回滚仅恢复原 web 镜像和边缘配置，并停止测试容器，保留全部数据与镜像。没有实际执行停服回滚演练。

详情见 [deployment-20261015.md](deployment-20261015.md)。本次不调用真实模型，界面载入及资源消费验证不等于实际对话效果验证。
