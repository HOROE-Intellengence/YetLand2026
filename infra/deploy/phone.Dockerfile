ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS build
WORKDIR /app/ai-virtual-phone
COPY ai-virtual-phone/package.json ai-virtual-phone/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY ai-virtual-phone ./
COPY packages/shared/src/contracts/phone.ts /app/packages/shared/src/contracts/phone.ts
ARG YELAN_WEB_ORIGIN
ENV NEXT_PUBLIC_YELAN_WEB_ORIGIN=${YELAN_WEB_ORIGIN} \
    NEXT_PUBLIC_YELAN_PHONE_MANAGED=true \
    YELAN_PHONE_MANAGED=true \
    NEXT_PUBLIC_SELF_HOSTED_MODE=true \
    NEXT_TELEMETRY_DISABLED=1 \
    NODE_OPTIONS=--max-old-space-size=6144
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM ${NODE_IMAGE}
WORKDIR /app/ai-virtual-phone
ENV NODE_ENV=production PORT=3001 HOST=0.0.0.0 \
    YELAN_PHONE_MANAGED=true NEXT_TELEMETRY_DISABLED=1
COPY --from=build --chown=node:node /app/ai-virtual-phone ./
USER node
EXPOSE 3001
CMD ["node", "scripts/local-next-server.mjs", "--prod"]
