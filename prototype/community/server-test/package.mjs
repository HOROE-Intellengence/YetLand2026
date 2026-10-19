import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { createHash, randomBytes } from 'node:crypto';
const root = path.resolve(import.meta.dirname, '../../..');
const dir = path.join(root, '.server/community-test-20261015');
const run = args => execFileSync(args[0], args.slice(1), { cwd: root, encoding: 'utf8' }).trim();
const sha = async file => { const h = createHash('sha256'); for await (const b of fs.createReadStream(file)) h.update(b); return h.digest('hex'); };
async function images(tags, file) {
  const dest = path.join(dir, file);
  const p = spawn('docker', ['save', ...tags], { stdio: ['ignore', 'pipe', 'inherit'] });
  const done = new Promise((ok, no) => p.on('exit', c => c === 0 ? ok() : no(new Error('docker save failed'))));
  await pipeline(p.stdout, createGzip({ level: 1 }), fs.createWriteStream(dest)); await done;
  const receipt = { file, sha256: await sha(dest), bytes: fs.statSync(dest).size, images: Object.fromEntries(tags.map(t => [t, run(['docker', 'image', 'inspect', '--format', '{{.Id}}', t])])) };
  fs.writeFileSync(dest + '.json', JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
}
if (process.argv.includes('--source-update')) {
  run(['tar','-czf',path.join(dir,'source-update.tar.gz'),'-C',dir,'source','compose.yml','source-hashes.json']);
  const file=path.join(dir,'source-update.tar.gz');
  const receipt={file:path.basename(file),sha256:await sha(file),bytes:fs.statSync(file).size};
  fs.writeFileSync(file+'.json',JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
} else if (process.argv.includes('--infra-images')) {
  await images(['ghcr.io/nodebb/nodebb:latest', 'bitnamilegacy/redis:8.0', 'yelan-web-caddy:community-entry-cn-20261015'], 'infra-images.tar.gz');
} else if (process.argv.includes('--phone-image')) {
  await images(['yelan-phone:community-test-20261015'], 'phone-image.tar.gz');
} else {
  const backup = JSON.parse(fs.readFileSync(path.join(root, '.local/community-prototype/batch-20261015-backup.json'))).dir;
  if (fs.existsSync(path.join(dir, 'community-snapshot.tar.gz'))) throw new Error('Snapshot already staged; do not overwrite a populated server snapshot');
  for (const name of ['redis', 'config', 'uploads', 'build', 'state/accounts']) fs.mkdirSync(path.join(dir, 'data', name), { recursive: true });
  for (const name of ['redis', 'config', 'uploads']) run(['tar', '-xzf', path.join(backup, `community-${name}.tgz`), '-C', path.join(dir, 'data', name)]);
  // Preserve Linux symlinks by unpacking the build archive on the destination host.
  fs.copyFileSync(path.join(backup, 'community-build.tgz'), path.join(dir, 'community-build.tgz'));
  fs.copyFileSync(path.join(backup, 'local/pre-batch-20261015.sqlite'), path.join(dir, 'data/state/installations.sqlite'));
  fs.copyFileSync(path.join(backup, 'local/accounts/state.json'), path.join(dir, 'data/state/accounts/state.json'));
  const runtime = JSON.parse(fs.readFileSync(path.join(backup, 'local/runtime.json')));
  runtime.bridgeSecret = randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(dir, 'data/state/runtime.json'), JSON.stringify(runtime));
  const env = fs.readFileSync(path.join(backup, 'local/compose.env.local'), 'utf8');
  fs.writeFileSync(path.join(dir, '.env'), env.replace(/^COMMUNITY_BRIDGE_SECRET=.*$/m, 'COMMUNITY_BRIDGE_SECRET=' + runtime.bridgeSecret));
  const configPath = path.join(dir, 'data/config/config.json');
  const config = JSON.parse(fs.readFileSync(configPath));
  config.url = 'https://forum.community.yetland.cn';
  config.secret = randomBytes(32).toString('hex');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  fs.mkdirSync(path.join(dir, 'secrets'), { recursive: true });
  fs.copyFileSync(path.join(root, '.local/community-prototype/server-test/gate.json'), path.join(dir, 'secrets/gate.json'));
  run(['tar', '--exclude=data/build', '-czf', path.join(dir, 'community-snapshot.tar.gz'), '-C', dir, 'source', 'data', 'secrets', '.env', 'compose.yml', 'source-hashes.json', 'web-scope.json', 'community-build.tgz']);
  const file = path.join(dir, 'community-snapshot.tar.gz');
  const receipt = { file: path.basename(file), sha256: await sha(file), bytes: fs.statSync(file).size, backup, preserved: ['resource IDs', 'versions', 'publication states', 'authors', 'review audit', 'forum topic IDs'], changed: ['runtime public URLs', 'internal bridge secret', 'forum session signing secret'] };
  fs.writeFileSync(file + '.json', JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
}
