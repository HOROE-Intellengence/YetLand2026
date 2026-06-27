// gray:snapshot — 备份 apps/api/.local/state.json 到带时间戳目录
// 兼容 Windows PowerShell + Git Bash
import { existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const stateFile = resolve(root, 'apps', 'api', '.local', 'state.json');

if (!existsSync(stateFile)) {
  console.log('[gray:snapshot] state.json not found — nothing to snapshot.');
  process.exit(0);
}

const ts = new Date().toISOString().replace(/[:.]/g, '-');
const snapshotDir = resolve(root, 'apps', 'api', '.local', `snapshot-${ts}`);
mkdirSync(snapshotDir, { recursive: true });

const dest = resolve(snapshotDir, 'state.json');
copyFileSync(stateFile, dest);

console.log(`[gray:snapshot] Saved → ${dest}`);
