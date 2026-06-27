// gray:reset — 恢复 seeded baseline state.json
// 如果没有 baseline，提示先 seed，不静默乱删
// 兼容 Windows PowerShell + Git Bash
import { existsSync, mkdirSync, readdirSync, copyFileSync, unlinkSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const localDir = resolve(root, 'apps', 'api', '.local');
const stateFile = join(localDir, 'state.json');
const baselineFile = join(localDir, 'state.baseline.json');

// 按时间倒序取快照目录
function findLatestSnapshot() {
  if (!existsSync(localDir)) return null;
  const entries = readdirSync(localDir, { withFileTypes: true });
  const snapshotDirs = entries
    .filter((e) => e.isDirectory() && e.name.startsWith('snapshot-'))
    .map((e) => ({
      name: e.name,
      mtime: statSync(join(localDir, e.name)).mtime.getTime(),
    }))
    .sort((a, b) => b.mtime - a.mtime);
  if (snapshotDirs.length === 0) return null;
  return join(localDir, snapshotDirs[0].name, 'state.json');
}

// 1. 优先 baseline
if (existsSync(baselineFile)) {
  if (existsSync(stateFile)) {
    // 先备份现状
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const preResetDir = join(localDir, `snapshot-pre-reset-${ts}`);
    mkdirSync(preResetDir, { recursive: true });
    copyFileSync(stateFile, join(preResetDir, 'state.json'));
    console.log(`[gray:reset] Pre-reset backup → ${preResetDir}`);
  }
  copyFileSync(baselineFile, stateFile);
  console.log('[gray:reset] Restored from state.baseline.json');
  process.exit(0);
}

// 2. 次选最近快照
const latestSnapshot = findLatestSnapshot();
if (latestSnapshot) {
  if (existsSync(stateFile)) unlinkSync(stateFile);
  copyFileSync(latestSnapshot, stateFile);
  console.log(`[gray:reset] Restored from latest snapshot → ${latestSnapshot}`);
  process.exit(0);
}

// 3. 既无 baseline 也无快照
console.error('[gray:reset] No baseline or snapshot found.');
console.error('  Run "pnpm seed" first to create seeded data, then:');
console.error('  copy apps\\api\\.local\\state.json apps\\api\\.local\\state.baseline.json');
console.error('  Or create a snapshot first with "pnpm gray:snapshot".');
process.exit(1);
