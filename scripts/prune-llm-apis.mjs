// 一次性清理：从持久化 store 里删除「非指定」的 LLM API 条目。
// 「指定」= 被 mainApiId / sidecarApiId / sidecarTaskApiIds 任一指针引用的条目。
// 其余条目（如备用的 env-nvidia/glm-5.1）一律视为可删的扩展/兜底候选。
//
// 安全：默认 dry-run，只打印将删什么；加 --apply 才真正落盘，且落盘前自动备份。
// 用法：
//   node scripts/prune-llm-apis.mjs                 # 预演（不改任何东西）
//   node scripts/prune-llm-apis.mjs --apply         # 执行删除（先备份）
//   YELAN_STATE_FILE=/path/to/state.json node scripts/prune-llm-apis.mjs --apply
//
// 注意：若 api 服务正在运行，请先停服再 --apply —— 否则运行中的进程可能在退出时
// 用内存态覆盖回被删的条目。

import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

// 与 apps/api/src/store/persistence.ts 同一套路径解析
function resolveStateFile() {
  if (process.env.YELAN_STATE_FILE) return resolve(process.env.YELAN_STATE_FILE);
  const dir = process.env.YELAN_STATE_DIR
    ? resolve(process.env.YELAN_STATE_DIR)
    : resolve(repoRoot, 'apps', 'api', '.local');
  return join(dir, 'state.json');
}

const stateFile = resolveStateFile();
if (!existsSync(stateFile)) {
  console.error(`✗ 找不到 state.json：${stateFile}`);
  console.error('  若线上路径不同，用 YELAN_STATE_FILE=... 指定。');
  process.exit(1);
}

let state;
try {
  state = JSON.parse(readFileSync(stateFile, 'utf8'));
} catch (e) {
  console.error(`✗ 解析 state.json 失败：${e.message}`);
  process.exit(1);
}

const inv = state.llmApiInventory;
if (!inv || !inv.entries || typeof inv.entries !== 'object') {
  console.error('✗ state.json 里没有 llmApiInventory.entries，无需清理。');
  process.exit(1);
}

const designated = new Set(
  [inv.mainApiId, inv.sidecarApiId, ...Object.values(inv.sidecarTaskApiIds ?? {})].filter(Boolean),
);

const allIds = Object.keys(inv.entries);
const keep = allIds.filter((id) => designated.has(id));
const remove = allIds.filter((id) => !designated.has(id));

const fmt = (id) => {
  const e = inv.entries[id];
  return `${id}  (${e?.model ?? '?'} @ ${e?.baseUrl ?? '?'}${e?.enabled === false ? ', disabled' : ''})`;
};

console.log(`state.json: ${stateFile}\n`);
console.log('指针：');
console.log(`  mainApiId         = ${inv.mainApiId ?? '(null)'}`);
console.log(`  sidecarApiId      = ${inv.sidecarApiId ?? '(null)'}`);
console.log(`  sidecarTaskApiIds = ${JSON.stringify(inv.sidecarTaskApiIds ?? {})}\n`);

console.log(`保留（被指针引用，${keep.length}）：`);
keep.forEach((id) => console.log(`  ✓ ${fmt(id)}`));
console.log(`\n${APPLY ? '删除' : '将删除（预演）'}（无指针引用，${remove.length}）：`);
remove.forEach((id) => console.log(`  ✗ ${fmt(id)}`));

if (remove.length === 0) {
  console.log('\n无可删条目，库已干净。');
  process.exit(0);
}

if (!APPLY) {
  console.log('\n这是预演，未改动任何文件。确认无误后加 --apply 执行。');
  process.exit(0);
}

// 备份后落盘
const backup = `${stateFile}.prune-${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
copyFileSync(stateFile, backup);
for (const id of remove) delete inv.entries[id];
writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');

console.log(`\n✓ 已删除 ${remove.length} 条，备份：${backup}`);
console.log('  若 api 服务在运行，请重启使其重新加载。');
