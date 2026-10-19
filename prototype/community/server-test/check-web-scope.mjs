import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root = path.resolve(import.meta.dirname, '../../..');
const dir = path.join(root, '.server/community-test-20261015');
process.env.VITE_API_BASE = 'https://yetland.cn';
process.env.VITE_PHONE_URL = 'https://phone.yetland.cn';
process.env.VITE_USE_MOCK = 'false';
const files = ['apps/web/src/scenes/LandingScene.tsx', 'apps/web/src/scenes/LandingScene.module.css'];
const previous = new Map(files.map(f => [path.join(root, f).replaceAll('\\', '/'), execFileSync('git', ['show', `HEAD:${f}`], { cwd: root, encoding: 'utf8' })]));
// Use the shipped shared-contract snapshot, excluding later unrelated local schemas.
const shared = path.join(dir, 'deployed-shared');
for (const f of fs.readdirSync(shared, { recursive: true }).filter(f => fs.statSync(path.join(shared, f)).isFile())) {
  previous.set(path.join(root, 'packages/shared/src', f).replaceAll('\\', '/'), fs.readFileSync(path.join(shared, f), 'utf8'));
}
const { build } = await import(pathToFileURL(path.join(root, 'apps/web/node_modules/vite/dist/node/index.js')).href);
await build({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'warn',
  plugins: [{ name: 'scope-baseline', enforce: 'pre', load(id) { return previous.get(id); } }],
  build: { outDir: path.join(dir, 'web-baseline'), emptyOutDir: true },
});
const deployed = path.join(root, '.server/admin-voices-20261012/cn');
const digest = f => createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const js = fs.readdirSync(path.join(dir, 'web-baseline/assets')).find(f => f.endsWith('.js'));
const baselineMatch = fs.existsSync(path.join(deployed, 'assets', js)) && digest(path.join(deployed, 'assets', js)) === digest(path.join(dir, 'web-baseline/assets', js));
fs.writeFileSync(path.join(dir, 'web-scope.json'), JSON.stringify({ baselineMatch, js, sourceChanges: files }, null, 2));
if (!baselineMatch) throw new Error('Current web baseline differs from deployed assets; isolate unrelated differences before shipping');
console.log('Web baseline matches deployed JavaScript exactly; only landing entry changes are included.');
for (const f of files) previous.delete(path.join(root, f).replaceAll('\\', '/'));
await build({ root: path.join(root, 'apps/web'), configFile: path.join(root, 'apps/web/vite.config.ts'), logLevel: 'warn',
  plugins: [{ name: 'shipped-shared', enforce: 'pre', load(id) { return previous.get(id); } }],
  build: { outDir: path.join(dir, 'web'), emptyOutDir: true },
});
