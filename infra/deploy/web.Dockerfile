# ============================================================================
#  夜阑 · caddy + apps/web 同域托管镜像
#  ----------------------------------------------------------------------------
#  和 Dockerfile（apps/api）同理：多阶段构建。
#    stage1  node  —— pnpm 构建 apps/web，产物 dist/
#    stage2  caddy —— 把 dist/ 烘进 /srv，由 Caddyfile 的 file_server 托管
#
#  关键：web 用绝对地址同源调 API（见 apps/web/src/config/env.ts）。
#  这里把 VITE_API_BASE 在「构建期」注入成 https://<DOMAIN>，所以浏览器里
#  fetch 的是 https://yetland.cn/api/...，经 Caddy 反代到内网 api:8787。
#  注意：env.ts 兜底是 `VITE_API_BASE || 'http://localhost:8787'`，空串是
#  falsy 会回落到 localhost，故必须传入非空绝对地址。
#
#  构建（由 docker-compose 自动跑，无需手动）：
#    docker build -t yelan-web-caddy -f infra/deploy/web.Dockerfile \
#      --build-arg WEB_API_BASE=https://yetland.cn .
# ============================================================================

# ── stage1: 构建 web ────────────────────────────────────────────────────────
FROM node:20-alpine AS web-build
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# 先 copy 配置文件（layer 缓存优化）
COPY pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/design-tokens/package.json packages/design-tokens/

RUN pnpm install --no-frozen-lockfile

# 拷源码（web + 它依赖的两个 workspace 包）
# tsconfig.base.json 必带：web 的 build 是 `tsc -b && vite build`，web/tsconfig.json
# extends ../../tsconfig.base.json，缺它 tsc 会直接报错中断（api 镜像走 tsx 故无此需求）。
COPY tsconfig.base.json ./
COPY apps/web ./apps/web
COPY packages/shared        ./packages/shared
COPY packages/design-tokens ./packages/design-tokens

# 构建期注入 API 基址：默认占位，compose 会传真实 https://<DOMAIN>
ARG WEB_API_BASE=https://localhost
ENV VITE_API_BASE=${WEB_API_BASE}
ARG WEB_PHONE_URL=
ENV VITE_PHONE_URL=${WEB_PHONE_URL}
# 同域托管即真实 server，关掉 mock
ENV VITE_USE_MOCK=false

RUN pnpm --filter @yelan/web build

# ── stage2: caddy 托管 ───────────────────────────────────────────────────────
FROM caddy:2-alpine
# Caddyfile 由 docker-compose 以只读卷挂载到 /etc/caddy/Caddyfile，这里不 COPY，
# 改 Caddyfile 后 `docker compose restart caddy` 即可生效，无需重建镜像。
COPY --from=web-build /app/apps/web/dist /srv
