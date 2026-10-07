# 夜阑 · 服务器一键部署

> 在任意一台 Linux VPS 上跑起完整后台 + 自动 HTTPS。无需 Cloudflare 账号。

## 前置

- 装好 Docker + Docker Compose（`apt install docker.io docker-compose-plugin`）
- 一个域名，DNS A 记录指到本服务器
- 80 / 443 端口开放（防火墙放行）

> **服务器不用装 Node、也不用装 pnpm。** 项目对 Node 20 / pnpm 9 的版本要求全部钉死在
> Docker 镜像内部（`apps/api` 与 `web.Dockerfile` 各自 `corepack prepare pnpm@9` 在容器里构建），
> 宿主机只要有 Docker 就行。换句话说：版本敏感性被容器封死，你在服务器上永远不用碰 `npm install`。

## 三步部署

```bash
# 1. 克隆仓库到服务器
git clone <repo-url> yelan && cd yelan/infra/deploy

# 2. 配置环境
cp .env.example .env
nano .env       # 至少改：DOMAIN / ADMIN_TOKEN / 任一 LLM key
sh check.sh     # 部署前防呆检查

# 3. 启动
docker compose up -d --build
```

完成。访问：

- **网页前端**：`https://your-domain.com/` —— 根路径直接出 web 应用（同域托管，无需单独部署前端）
- API：`https://your-domain.com/api/...` —— 前端就是打这个同源地址
- 健康检查：`https://your-domain.com/health`
- 控制台：`https://your-domain.com{ADMIN_PATH}`（即 .env 里的秘密路径，默认占位 `/__console_change_me__`，用 ADMIN_TOKEN 登录）。直接访问 `/admin` 会被装死成 landing 页，详见「安全建议」。

> **同域托管说明**：`caddy` 容器不再是单纯的反代，而是用多阶段构建（`web.Dockerfile`）把 `apps/web`
> 编译进自己的 `/srv` 一起对外。前端在构建期就把 `VITE_API_BASE` 烘成 `https://${DOMAIN}`，
> 所以网页和 API 天然同源、不用配跨域。代价：caddy 镜像从「拉现成」变成「本地构建」，
> 升级/改前端都必须带 `--build`（见下）。

## 这套在跑什么（一张图看懂）

起来后是 **两个容器**：

```
公网用户
   │  https://your-domain.com
   ▼
┌─────────────┐   只有它对外开 80/443
│  caddy      │   = 门卫 + 前台
│             │   /        → 自己 /srv 里的 web 网页（烘进镜像）
│             │   /api/*   → 转发给 api
└─────────────┘
   │  内网 http://api:8787（外面碰不到）
   ▼
┌─────────────┐   真正干活的后端
│  apps/api   │   数据全在 ./_data/state.json
└─────────────┘
```

**Caddy 是干嘛的？** 它是唯一对外的「门卫」，自己不处理业务，做四件事：

1. **HTTPS**：自动给 `DOMAIN` 申请/续期证书。`apps/api` 只会裸 HTTP，加密全靠它。
2. **出网页**：根路径 `/` 直接吐 `/srv` 里的 web 前端（构建期烘进 caddy 镜像），SPA 路由兜底到 `index.html`。
3. **转发**：把 `/api/*`、`/health` 转给内网的 `api:8787`（`apps/api` 永远不直接对公网）。
4. **藏后台**：把控制台藏到 `ADMIN_PATH` 那个秘密路径；别人访问 `/admin` 只会看到一张假落地页。

**记住一句话**：Caddy 管「门口 + 前台」（域名、证书、出网页、转发、藏后台），`apps/api` 管「干活」（业务、数据）。

**出问题先看谁？**

- 网站打不开 / 证书报错 / 502 → 多半是 **Caddy**：`docker compose logs -f caddy`（证书要 DNS 已指过来 + 80/443 开放）。
- 网站能开但功能报错 / 登录不了 / 对话失败 → 多半是 **api**：`docker compose logs -f api`。

**不要乱动**：改 `Caddyfile` 后必须 `docker compose restart caddy`；本地调试想绕开证书麻烦，可以不用 Caddy、直接连 `apps/api` 的 8787（本地不需要 HTTPS）。

## 常用命令

| 命令 | 说明 |
|---|---|
| `docker compose ps` | 看容器状态 |
| `docker compose logs -f api` | 跟 apps/api 日志 |
| `docker compose logs -f caddy` | 跟 Caddy（看证书申请进度） |
| `docker compose restart api` | 重启后台 |
| `docker compose down` | 停掉所有容器（数据保留） |
| `docker compose up -d --build` | 升级 / 改了前端或 Caddyfile 后重建（**caddy 是本地构建，必须带 `--build` 才会重新编译前端**） |
| `docker compose restart caddy` | 只改了 .env 里的 `ADMIN_PATH` 等运行期变量时用（不重建镜像） |
| `sh check.sh` | 部署前检查 .env、token、LLM key 和 ECS 下一步命令 |

## 给运维 AI 的部署指令（可直接复制转发）

> 这一节是写给「服务器上那个运维 AI」看的。分三种场景：**首次部署**、**更新已在跑的服务（git pull）**、**覆盖/删库重传**。
> 你（人类）只需把对应那一段整段复制给它即可。所有命令都在服务器仓库目录里执行。

### 场景 A · 首次部署

```
任务：在本服务器用 Docker 把「夜阑」完整跑起来（web 前端 + API 同域，自动 HTTPS）。

前提确认（缺一不可，先自检再动手）：
1. 本机已装 Docker + Docker Compose；不需要装 Node/pnpm（构建在容器内完成）。
2. 域名 DNS 的 A 记录已指向本机公网 IP；80 和 443 端口已放行。

步骤：
1. git clone <仓库地址> yelan && cd yelan/infra/deploy
2. cp .env.example .env
   编辑 .env，必改：
     - DOMAIN=你的真实域名（不带 http://，例 yetland.cn）
     - ADMIN_TOKEN=强随机串（openssl rand -hex 32 生成，≥32 位）
     - 任填一个 LLM key：ANTHROPIC_API_KEY / OPENAI_API_KEY / DEEPSEEK_API_KEY / NVIDIA_API_KEY
   强烈建议同时改：
     - ADMIN_PATH=你自己的随机秘密路径（例 /x7Kq9-ops），别用 /admin
3. sh check.sh        # 防呆检查，必须全 PASS（或只剩 WARN）才继续
4. docker compose up -d --build   # 首次构建较慢（要在容器里编译前端），耐心等
5. docker compose ps  # 两个容器（caddy、api）都应是 Up

验收（逐条确认并回报结果）：
- 浏览器开 https://<域名>/        → 出网页，不是 "yelan backend" 那行纯文字
- curl -fsS https://<域名>/health → 返回正常
- 访问 https://<域名><ADMIN_PATH> → 控制台可用 ADMIN_TOKEN 登录
若 https 报证书错：等 1-2 分钟（Let's Encrypt 签发），并确认 DNS 已生效、80/443 开放，
再看 docker compose logs -f caddy。
```

### 场景 B · 更新已在跑的服务（拉取最新代码并重建）

```
任务：把本服务器上已在运行的「夜阑」更新到仓库最新代码，不能丢用户数据。

绝对红线（先读再做）：
- 不要删除、覆盖、重置 infra/deploy/.env —— 里面是本机的 secret（ADMIN_TOKEN、LLM key、ADMIN_PATH），不在 git 里，丢了要重配。
- 不要删除、覆盖 infra/deploy/_data/ —— 这是全部用户/会话/审计的唯一数据，不在 git 里。
- 不要 git reset --hard / git clean -fd（会冲掉上面两样）。

步骤：
1. cd yelan/infra/deploy
2. cp _data/state.json _data/backup-手动-$(date +%F).json   # 更新前先手动备份一次
3. cd ../..        # 回到仓库根
4. git pull        # 只拉代码，.env 和 _data/ 已被 gitignore，git 不会碰它们
5. cd infra/deploy
6. docker compose up -d --build   # --build 必须带，否则前端/Caddyfile 改动不生效
7. docker compose ps              # 确认 caddy、api 都 Up

验收：同场景 A 的三条（首页出网页 / /health 正常 / 控制台可登录）。
若只改了 .env 里的 ADMIN_PATH 这类运行期变量、没改代码：跳过 git pull，
直接 docker compose restart caddy 即可，无需重建。
```

### 场景 C · 覆盖 / 删库重传（每次重新上传整个项目）

```
任务：用一份全新的项目代码彻底替换服务器上的旧代码，再跑起来。不能丢用户数据和 secret。

先认清两样东西在哪、各自怎么保住：
- 用户数据：在 infra/deploy/_data/（宿主机目录，bind 挂进容器的 .local）。
  里面 state.json 是真理源，snapshots/ 是自动快照。重传前必须先搬走、传完搬回。
- secret 配置：infra/deploy/.env（DOMAIN / ADMIN_TOKEN / LLM key / ADMIN_PATH）。
  这不是「用户数据」，任何数据导出都导不出它。同样必须单独备份、传完放回。

安全的覆盖重传流程：
1. cd 到旧仓库的 infra/deploy
2. 先把要保住的两样挪到仓库外面（绝不能跟着被删）：
     mkdir -p ~/yelan-keep
     cp -r _data ~/yelan-keep/_data
     cp .env  ~/yelan-keep/.env
3. docker compose down            # 停容器（数据已在 ~/yelan-keep，安全）
4. 删掉旧代码、放上新代码（git clone 新的，或 scp/解压覆盖整个仓库目录）
5. 把保住的两样放回新代码的 infra/deploy/：
     cp -r ~/yelan-keep/_data infra/deploy/_data
     cp    ~/yelan-keep/.env  infra/deploy/.env
6. cd infra/deploy && sh check.sh        # 确认 .env 仍完好
7. docker compose up -d --build
8. docker compose ps + 三条验收（见场景 A）

一句话红线：删代码前，_data 和 .env 必须已经躺在仓库目录外面了。顺序错了就丢数据。
```



服务器是靠 `git pull` 取代码的，所以本地改完要先推上去，运维 AI 才拉得到：

1. 确认服务器 `git pull` 跟踪的是哪个远程/分支（本仓库有多个远程，别推错）。
2. 只提交部署相关改动，别把无关的本地改动一起带上去：
   ```bash
   git add infra/deploy/web.Dockerfile infra/deploy/docker-compose.yml infra/deploy/Caddyfile infra/deploy/README.md
   git commit -m "deploy: web 同域托管 + 部署指引"
   git push <对应远程> <对应分支>
   ```
3. 推完，把上面「场景 B」整段发给运维 AI。

> **为什么不建议「重新上传整个项目」**：整体 scp/覆盖极易误删服务器上的 `.env`（secret）和
> `_data/`（用户数据）——这两样都不在 git 里，只活在服务器本地。走 `git pull` 天然安全：
> git 根本看不见它们。

## 数据备份

`./_data/state.json` 是后台所有用户/烛账/会话/审计的真理源。后端还会在 `./_data/snapshots/` 自动留最近 12 份快照（崩溃/损坏时自恢复用），所以**备份整个 `_data/` 目录**比只拷 `state.json` 更稳：

```bash
# 整目录备份（含快照），保留 7 天
0 3 * * * cd /path/to/yelan/infra/deploy && cp -r _data _data-backup-$(date +\%F) && find . -maxdepth 1 -name '_data-backup-*' -mtime +7 -exec rm -rf {} +
```

只想拷主文件也行（轻量但不含快照）：

```bash
0 3 * * * cd /path/to/yelan/infra/deploy && cp _data/state.json _data/backup-$(date +\%F).json && find _data -name 'backup-*.json' -mtime +7 -delete
```

## 把后台从本机搬到服务器（一键切换）

本仓库的部署模式由 `DEPLOY_MODE` 单一变量决定（`local` / `server`）：

| 场景 | 启动方式 | profile 行为 |
|---|---|---|
| 本机开发 | `pnpm start:local` 或 `pnpm dev:mock` | bind 127.0.0.1，CORS 全开，admin 默认 token 可用 |
| 服务器生产 | `docker compose up -d` | bind 0.0.0.0，CORS 白名单，强制非默认 token |

前端切换 API 端点：

- **Web**：`localStorage['yelan.apiBase']` 或访问 `?api=https://api.example.com` 一次会保存
- **Admin 控制台**：顶栏新增 "API endpoint" 按钮，可任意切换地址；当前模式徽章实时显示

## 安全建议

- ADMIN_TOKEN 改成 32 位以上随机串：`openssl rand -hex 32`
- CORS_ORIGINS 只列你的真实前端域名，别写 `*`
- 控制台秘密入口：在 .env 设 `ADMIN_PATH=/你的随机串`（别用 `/admin`），控制台改从这个路径进；
  直接访问 `/admin` 会被 Caddy 装死成 landing，和「路径不存在」无法区分，降低被扫描发现的概率。
  这是降噪手段、不替代鉴权（真正的门仍是 ADMIN_TOKEN）；轮换路径只需改 .env 后 `docker compose restart caddy`。
- 想彻底关掉控制台（生产更稳）：在 .env 设 `ENABLE_ADMIN_CONSOLE=false`，服务器根本不托管页面，改用独立 admin 前端
- Caddy 直连部署保持 `INTERNAL_TOKEN_REQUIRED=false`；只有走 Cloudflare Worker edge 转发到 Node 时才改 `true`
- 定期更新基镜像（Caddy / Node）：`docker compose build --pull && docker compose up -d`（caddy 是本地构建，不能用 `docker compose pull`，要用 `build --pull` 拉最新基镜像重建）

## 升级到 Postgres（可选）

`待完善功能.md` § A 路线 1 详述。当前默认 JSON 文件持久化对单机数千用户够用。

## 独立小手机（可选）

保留原聊天、普通语音、高质量语音和 API 服务；新增手机容器与独立子域名。设置 `.env` 中的
`DOMAIN`（夜阑主站）和 `PHONE_DOMAIN`（例如 `phone.example.com`），两者 DNS 均指向本服务器。
手机只通过容器内网访问现有 API，镜像不接收任何模型密钥。

```sh
docker compose -f docker-compose.yml -f docker-compose.phone.yml config --quiet
docker compose -f docker-compose.yml -f docker-compose.phone.yml up -d --build
```

主站构建时注入手机入口地址；手机构建时固定允许握手的主站 origin。域名变更需要重建两个前端镜像。
用户从主站功能选择页进入小手机，手机直接链接不会取得登录态。
原 Compose 文件独立运行时保持原两服务结构；手机覆盖文件用独立 Caddy 配置导入原规则，不覆盖原入口。

构建建议预留至少 6 GiB Node 堆空间。手机状态沿用浏览器存储，按夜阑账号隔离，不提供新增跨端同步。
托管模式禁止原账号、独立云部署、工具代理和独立模型配置接口；保留的夜阑接口逐次鉴权。
首次上线仍需按 `docs/phone-integration-plan.md` 完成实际 HTTPS、账号隔离、模型、角色规则与语音验收。
