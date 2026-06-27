# 控制台秘密入口防扫描审计

日期：2026-06-11

## 范围

把运营后台从众所周知的 `/admin` 藏到部署 `.env` 里的秘密路径 `{$ADMIN_PATH}`（例 `/KSHHT`），降低被扫描器发现的概率。秘密路径只存在于服务器 `.env`，不进 git，可随时轮换。

- `infra/deploy/Caddyfile` 在反代层做路径改写与「装死」。
- `infra/deploy/docker-compose.yml` 给 caddy 容器注入 `ADMIN_PATH`。
- `infra/deploy/.env.example` + `check.sh` 配置项与部署前自检。
- `apps/api/src/index.ts` 堵住 `/admin/*` SPA fallback 漏洞。

## 方案

采用「反代改路径 + 一处后端堵洞」，而非整体迁移代码。理由：秘密路径本质是凭证，不该写进 `vite.config.ts`/源码/git 历史；硬编码点多易漏；轮换成本高。

Caddy 三块（顺序：assets 在 `/admin*` 之前，靠 handle specificity 兜底）：

1. `handle {$ADMIN_PATH}*`：`uri replace {$ADMIN_PATH} /admin` 改写转发；`header_down Location /admin {$ADMIN_PATH}` 反向改写后端可能的 302（防带尾斜杠时被弹回被封路径）。
2. `handle /admin/assets/*`：放行哈希资源。dist 按 `base=/admin/` 构建，首页引用绝对路径 `/admin/assets/<hash>.js`，文件名带构建 hash 不可枚举。
3. `handle /admin*`：返回与「路径不存在」逐字节相同的 landing，扫描器无法区分「被藏」与「不存在」。

后端堵洞：`/admin/*` 静态处理器查无文件时返回 404，不再回退 `index.html`。本应用是 hash 路由（`#overview` 等），无需 SPA fallback。

## 风险与处理

| 风险 | 处理 |
|---|---|
| `/admin/assets/<乱猜>` 命中 SPA fallback 拿到控制台 HTML，伪装穿帮 | `apps/api/src/index.ts` 改为 404；Caddy 放行 assets 也只放真实哈希文件 |
| 带尾斜杠的 `/KSHHT/` 经改写后被后端 302 弹回被封的 `/admin` | Caddy `header_down Location` 反向改写（实测当前路由顺序下 `/admin/` 直接 200，该改写为冗余保险） |
| `ADMIN_PATH` 误设为 `/admin` 或空，导致伪装失效或 Caddy 规则冲突 | `check.sh` 校验：占位/空 warn，`=/admin` fail，过短 warn，无前导 `/` fail；compose 与 Caddyfile 双层默认占位兜底 |
| 误以为改路径＝加固 | 文档明确：降噪非鉴权，真正的门仍是 `ADMIN_TOKEN`；秘密路径会进浏览器历史与 Caddy 日志 |
| 控制台「DB 工具 → 打开旧说明」跳 `/admin-legacy` 落到 landing | 已知代价；DB GUI 本体在 `localhost:5174`，核心后台走 hash 路由不受影响 |

## 验证

本机无 Docker/Caddy，验证分两层：

- **后端行为（Caddy 转发后命中的路径）**：起真实 `apps/api`，curl 实测 —— `/admin`、`/admin/` → 200 控制台 HTML；真实哈希资源 → 200；`/admin/login`、`/admin/randompath`、`/admin/assets/<乱猜>.js` → **404 且响应体为 `404 Not Found` 而非控制台 HTML**。
- **自检脚本**：`check.sh` 对 `ADMIN_PATH` 五种取值（占位 / `/admin` / 自定义 / 过短 / 无斜杠）输出 warn/fail/pass 全部符合预期。
- **回归**：`pnpm --filter @yelan/api typecheck` 通过；`pnpm --filter @yelan/api test` 325 测试全过（39 文件）。

Caddyfile 语法未机器校验（本机无 caddy/docker），已逐行手工核对。**上线前在服务器执行**：

```bash
docker compose exec caddy caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
```

## 后续

- 更彻底的方案是 `ENABLE_ADMIN_CONSOLE=false`：服务器根本不托管控制台页面，只剩 `/api/admin/*` 一个攻击面，代价是本地起 admin 前端。
- 真正的加固应落在 `/api/admin/*`：出口 IP 固定可加 Caddy IP 白名单，否则加 `basic_auth`，非法访问回 404 装死，挡 token 爆破。改路径对此无效。
