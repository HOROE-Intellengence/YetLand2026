# ============================================================================
#  夜阑 · apps/api 生产镜像
#  ----------------------------------------------------------------------------
#  这个镜像把 apps/api 包装成 1 个可独立部署的容器：
#    - 不需要 Cloudflare 账号
#    - 不依赖 Postgres（默认 JSON 文件持久化）
#    - 状态卷挂在 /data，docker-compose 会持久化
#
#  构建：
#    docker build -t yelan-api:latest -f infra/deploy/Dockerfile .   # 在仓库根跑
#  运行：
#    docker run -p 8787:8787 -e DEPLOY_MODE=server -e ADMIN_TOKEN=changeme yelan-api:latest
#  推荐：用 infra/deploy/docker-compose.yml 一键起。
# ============================================================================

FROM node:20-alpine AS base
WORKDIR /app

# libopus audio conversion; native SQLite builds if a musl prebuild is unavailable.
RUN apk add --no-cache ffmpeg python3 make g++

# corepack 启用 pnpm（Node 20 自带）
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# 先 copy 配置文件（layer 缓存优化）
COPY pnpm-workspace.yaml package.json ./
COPY tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/prompts/package.json packages/prompts/
COPY packages/llm/package.json packages/llm/
COPY apps/admin/package.json apps/admin/
COPY packages/design-tokens/package.json packages/design-tokens/

# 注：production 仍装 dev deps（因为 apps/api 用 tsx 直接跑 .ts）
# 想瘦身可以加一步 esbuild bundle，但现阶段保持简单
RUN pnpm install --no-frozen-lockfile

# 拷源码
COPY apps/api ./apps/api
COPY packages/shared  ./packages/shared
COPY packages/prompts ./packages/prompts
COPY packages/llm     ./packages/llm
COPY apps/admin       ./apps/admin
COPY packages/design-tokens ./packages/design-tokens

# Always serve the admin built from this checkout, never a stale local dist.
RUN pnpm --filter @yelan/admin build

# 烘 prompts（apps/api 现在直接读 yaml/md，但留着不亏）
RUN pnpm prompts:build || true

# 持久化目录（compose 会挂卷）
RUN mkdir -p /app/apps/api/.local
VOLUME ["/app/apps/api/.local"]

# server profile 默认值；docker-compose 会覆盖
ENV NODE_ENV=production
ENV DEPLOY_MODE=server
ENV MOCK_HOST=0.0.0.0
ENV MOCK_PORT=8787

EXPOSE 8787

# 健康检查（容器编排能感知）
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/health > /dev/null || exit 1

CMD ["pnpm", "--filter", "@yelan/api", "start"]
