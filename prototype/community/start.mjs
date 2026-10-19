import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const local = resolve(root, '.local/community-prototype');
mkdirSync(local, { recursive: true });
const runtimeFile = resolve(local, 'runtime.json');
const runtime = existsSync(runtimeFile)
  ? JSON.parse(readFileSync(runtimeFile, 'utf8'))
  : {
      bridgeSecret: randomBytes(32).toString('hex'),
      demoPassword: `Local!${randomBytes(20).toString('base64url')}`,
      adminPassword: `Local!${randomBytes(20).toString('base64url')}`,
      redisPassword: randomBytes(32).toString('hex'),
    };
writeFileSync(runtimeFile, JSON.stringify(runtime, null, 2));
const envFile = resolve(local, 'compose.env.local');
writeFileSync(
  envFile,
  `COMMUNITY_REDIS_PASSWORD=${runtime.redisPassword}\nCOMMUNITY_ADMIN_PASSWORD=${runtime.adminPassword}\nCOMMUNITY_BRIDGE_SECRET=${runtime.bridgeSecret}\n`,
);
const docker = spawnSync(
  'docker',
  ['compose', '--env-file', envFile, '-f', resolve(import.meta.dirname, 'compose.yml'), 'up', '-d'],
  {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true,
  },
);
if (docker.status !== 0) process.exit(docker.status || 1);
const readyDeadline = Date.now() + 90000;
let ready = false;
while (Date.now() < readyDeadline) {
  try {
    const health = await (
      await fetch('http://localhost:3038/api/health', { signal: AbortSignal.timeout(2500) })
    ).json();
    if (health.forum) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 500));
}
if (!ready) {
  console.error('容器已启动，但社区尚未就绪，请检查本原型日志。');
  process.exitCode = 1;
}
if (ready && !process.argv.includes('--no-phone')) await import('./start-phone.mjs');
console.log(
  '资源社区：http://localhost:3038\nNodeBB 论坛：http://localhost:4567\n日志：docker compose --env-file .local/community-prototype/compose.env.local -f prototype/community/compose.yml logs --tail 30',
);
