#!/usr/bin/env node
// ============================================================================
// 夜阑 · 跨平台启动器（设置 DEPLOY_MODE 后转交 pnpm）
// ----------------------------------------------------------------------------
// 用法：
//   node scripts/start.mjs local    # 本机 dev（同 pnpm dev:mock，但显式 mode=local）
//   node scripts/start.mjs server   # 服务器 prod 模式（host 0.0.0.0、CORS 白名单等）
//   node scripts/start.mjs full     # 本机：mock + web 同时跑（同 pnpm dev）
//
// 为什么需要这个脚本：
//   Windows 的 npm scripts 没法直接 `DEPLOY_MODE=server pnpm ...`（cmd 不识别这种语法）。
//   写 cross-env 又要加依赖。一个 30 行的 node 脚本最干净。
// ============================================================================
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');

const MODE = (process.argv[2] || 'local').toLowerCase();

const validModes = ['local', 'server', 'full'];
if (!validModes.includes(MODE)) {
  console.error(`未知模式 "${MODE}"，请用：${validModes.join(' / ')}`);
  process.exit(2);
}

// 设环境
const env = {
  ...process.env,
  DEPLOY_MODE: MODE === 'server' ? 'server' : 'local',
};

// 决定子命令
let args;
if (MODE === 'full') {
  // 本机：mock + web 同时
  args = ['dev']; // pnpm dev = parallel mock + web
} else if (MODE === 'server') {
  // 服务器 prod：只起 apps/api，不启 watch
  args = ['--filter', '@yelan/api', 'start'];
} else {
  // local：apps/api watch（最常用）
  args = ['dev:mock'];
}

const banner =
  MODE === 'server' ? '🌐 SERVER mode' :
  MODE === 'full'   ? '💻 LOCAL full（mock + web）' :
                       '💻 LOCAL mock';

console.log('');
console.log(`  ${banner}  · DEPLOY_MODE=${env.DEPLOY_MODE}`);
console.log(`  pnpm ${args.join(' ')}`);
console.log('');

const child = spawn('pnpm', args, {
  cwd: ROOT,
  env,
  stdio: 'inherit',
  shell: true, // Windows 下 pnpm 是 .cmd，必须 shell:true
});

child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  console.error('启动失败:', err.message);
  process.exit(1);
});
