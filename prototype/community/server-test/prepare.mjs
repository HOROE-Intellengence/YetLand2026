import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '../../..');
const dest = path.join(root, '.server/community-test-20261015');
fs.mkdirSync(dest, { recursive: true });
const source = path.join(dest, 'source');
const copy = file => {
  const target = path.join(source, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(path.join(root, file), target, { recursive: true, filter: s => !/\.(test|spec)\.[cm]?[jt]sx?$/.test(s) });
};
for (const folder of ['apps/api/src', 'packages/shared/src', 'prototype/community/public', 'prototype/community/nodebb-plugin-yelan-local', 'prototype/community/server-test']) copy(folder);
for (const file of ['prototype/community/boot-nodebb.sh', 'prototype/community/configure-nodebb.cjs']) copy(file);
// The isolated phone uses the existing local consumer; no production service is replaced.
for (const folder of ['app', 'components', 'lib', 'styles', 'custom-apps', 'data']) copy(`ai-virtual-phone/${folder}`);
for (const file of ['next.config.mjs', 'middleware.ts', 'tsconfig.json', 'postcss.config.mjs']) copy(`ai-virtual-phone/${file}`);
const base = 'yelan-phone:empty-reply-cn-20261013';
fs.writeFileSync(path.join(dest, 'Dockerfile.phone'), `FROM yelan-api:empty-reply-20261013 AS contract-deps
FROM yelan-phone:phone-reader-cn-20261013 AS build
USER root
RUN npm ci --include=dev --no-audit --no-fund
COPY source/ai-virtual-phone/ /app/ai-virtual-phone/
COPY source/packages/shared/src/ /app/packages/shared/src/
COPY --from=contract-deps /app/node_modules/.pnpm/zod@3.25.76/node_modules/zod/ /app/packages/shared/node_modules/zod/
ENV NEXT_PUBLIC_YELAN_WEB_ORIGIN=https://community.yetland.cn NEXT_PUBLIC_YELAN_PHONE_MANAGED=true NEXT_PUBLIC_SELF_HOSTED_MODE=true YELAN_PHONE_MANAGED=true YELAN_COMMUNITY_PROTOTYPE=true NEXT_TELEMETRY_DISABLED=1 NODE_OPTIONS=--max-old-space-size=6144
RUN rm -rf .next && npm run build
FROM ${base}
USER root
COPY source/ai-virtual-phone/ /app/ai-virtual-phone/
COPY source/packages/shared/src/ /app/packages/shared/src/
RUN rm -rf .next
COPY --from=build --chown=node:node /app/ai-virtual-phone/.next/ /app/ai-virtual-phone/.next/
USER node
`);
fs.writeFileSync(path.join(dest, 'Dockerfile.web'), 'FROM yelan-web-caddy:admin-voices-cn-20261012\nCOPY web/ /srv/\n');
fs.writeFileSync(path.join(dest, '.dockerignore'), '**\n!source/\n!source/**\n!web/\n!web/**\n!Dockerfile.*\n');
fs.copyFileSync(path.join(root, 'prototype/community/server-test/compose.yml'), path.join(dest, 'compose.yml'));
const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const files = fs.readdirSync(source, { recursive: true }).filter(f => fs.statSync(path.join(source, f)).isFile());
fs.writeFileSync(path.join(dest, 'source-hashes.json'), JSON.stringify(Object.fromEntries(files.map(f => [f.replaceAll('\\', '/'), hash(path.join(source, f))])), null, 2));
console.log(JSON.stringify({ sourceFiles: files.length, sourceDirectory: dest, productionApiReplaced: false }));
