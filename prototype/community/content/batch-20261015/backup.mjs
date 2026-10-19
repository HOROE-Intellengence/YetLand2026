import { mkdirSync, cpSync, writeFileSync, createWriteStream, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
const root = resolve(import.meta.dirname, '../../../..');
const dir = resolve(root, '.local/community-prototype/backups', new Date().toISOString().replace(/[:.]/g, '-'));
mkdirSync(dir, { recursive: true });
const run = (args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();
const bridge = 'yelan-community-prototype-bridge-1';
const forum = 'yelan-community-prototype-nodebb-1';
const redis = 'yelan-community-prototype-redis-1';
async function tar(container, path, name) {
  const out = createWriteStream(resolve(dir, name));
  const p = spawn('docker', ['exec', container, 'tar', 'czf', '-', '-C', path, '.'], { stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.pipe(out); let err = ''; p.stderr.on('data', b => err += b);
  await new Promise((ok, no) => p.on('close', code => code ? no(new Error(err)) : out.end(ok)));
}
// No service restart. SQLite online backup provides a consistent committed snapshot.
run(['exec', bridge, 'node', '-e', `const D=require('/app/apps/api/node_modules/better-sqlite3');new D('/app/.local/community-prototype/installations.sqlite').backup('/app/.local/community-prototype/pre-batch-20261015.sqlite').then(()=>{})`]);
mkdirSync(resolve(dir, 'local'));
for (const name of readdirSync(resolve(root, '.local/community-prototype'))) {
  if (name === 'backups') continue;
  cpSync(resolve(root, '.local/community-prototype', name), resolve(dir, 'local', name), { recursive: true });
}
// SAVE atomically writes the live Redis database, AOF remains enabled and untouched.
const envText = (await import('node:fs')).readFileSync(resolve(root, '.local/community-prototype/compose.env.local'), 'utf8');
const password = envText.match(/^COMMUNITY_REDIS_PASSWORD=(.*)$/m)?.[1]?.trim();
if (!password) throw new Error('Missing local Redis configuration');
run(['exec', '-e', `REDISCLI_AUTH=${password}`, redis, 'redis-cli', 'SAVE']);
await tar(redis, '/data', 'community-redis.tgz');
await tar(forum, '/opt/config', 'community-config.tgz');
await tar(forum, '/usr/src/app/public/uploads', 'community-uploads.tgz');
await tar(forum, '/usr/src/app/build', 'community-build.tgz');
writeFileSync(resolve(dir, 'backup.json'), JSON.stringify({ at: new Date().toISOString(), scope: 'local community only', sqlite: 'local/pre-batch-20261015.sqlite', volumes: ['community-redis', 'community-config', 'community-uploads', 'community-build'], servicesStopped: false, note: 'Copied while importer idle; online SQLite snapshot is canonical; Redis SAVE succeeded. Dependency-only anonymous node_modules volume is reproducible from pinned image.' }, null, 2));
writeFileSync(resolve(root, '.local/community-prototype/batch-20261015-backup.json'), JSON.stringify({ dir, completedAt: new Date().toISOString() }, null, 2));
console.log('Local backup complete:', dir);
