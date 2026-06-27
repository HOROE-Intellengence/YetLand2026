#!/usr/bin/env node
// ============================================================================
// 夜阑 · 一键初始化（setup）
// ----------------------------------------------------------------------------
// 用法：
//   pnpm setup           # 交互式：拷 .env、问你 API key、跑 pnpm install
//   pnpm setup --yes     # 全部用默认值，不问
//
// 流程：
//   1. 检查 .env 存在；不存在则从 .env.example 拷贝
//   2. 交互式询问 ANTHROPIC / OPENAI / DEEPSEEK 任一 key（按 Enter 跳过）
//   3. 写回 .env（保留已有 key，不覆盖）
//   4. 如果 node_modules/ 不存在 → 自动跑 pnpm install
//   5. 打印下一步：pnpm dev
//
// 设计原则：
//   - 幂等：跑 100 次跟跑 1 次结果一致
//   - 不破坏：已有的 key 不动；只补空字段
//   - 零依赖：只用 Node 内置 readline
// ============================================================================
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');
const ENV = join(ROOT, '.env');
const ENV_EXAMPLE = join(ROOT, '.env.example');

const C = { reset: '\x1b[0m', cyan: '\x1b[36m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m' };
const banner = (s) => `${C.bold}${C.cyan}${s}${C.reset}`;
const ok = (s) => `${C.green}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

function writeEnv(envMap) {
  // 保留 .env.example 的注释结构作为骨架；按 key 顺序写入
  // 没 .env.example 就直接 KEY=VALUE 一行行
  let template = '';
  if (existsSync(ENV_EXAMPLE)) template = readFileSync(ENV_EXAMPLE, 'utf8');

  const writtenKeys = new Set();
  const out = template.split(/\r?\n/).map((line) => {
    const m = line.match(/^([A-Za-z_][\w]*)\s*=\s*(.*)$/);
    if (!m) return line;
    writtenKeys.add(m[1]);
    return `${m[1]}=${envMap[m[1]] ?? m[2]}`;
  }).join('\n');

  // 模板里没列出的 key 追加在末尾
  const extras = Object.entries(envMap).filter(([k]) => !writtenKeys.has(k));
  const tail = extras.length ? '\n# ─── 由 setup.mjs 追加 ─────\n' + extras.map(([k, v]) => `${k}=${v}`).join('\n') + '\n' : '';
  writeFileSync(ENV, out + tail, 'utf8');
}

async function main() {
  const yes = process.argv.includes('--yes') || process.argv.includes('-y');

  console.log('');
  console.log(banner('  夜阑 · 一键初始化  '));
  console.log(dim('  会做：拷贝 .env / 交互问 API key / 必要时 pnpm install'));
  console.log('');

  // ─── 1. .env 落地 ────────────────────────────────────────────────────
  if (!existsSync(ENV)) {
    if (existsSync(ENV_EXAMPLE)) {
      copyFileSync(ENV_EXAMPLE, ENV);
      console.log(`  ${ok('✓')} 从 .env.example 创建 .env`);
    } else {
      writeFileSync(ENV, '# auto-created by pnpm setup\n', 'utf8');
      console.log(`  ${ok('✓')} 创建空 .env（.env.example 不存在）`);
    }
  } else {
    console.log(`  ${ok('✓')} .env 已存在 — 不覆盖，只补空字段`);
  }

  const envMap = parseEnv(readFileSync(ENV, 'utf8'));

  // ─── 2. 交互问 API key ───────────────────────────────────────────────
  const rl = !yes ? createInterface({ input, output }) : null;
  async function ask(prompt, current) {
    if (yes || !rl) return current;
    if (current && current.length > 10) {
      const ans = await rl.question(`  ${prompt} ${dim('（已设，回车保留 / 输新值覆盖）')}: `);
      return ans.trim() || current;
    }
    const ans = await rl.question(`  ${prompt} ${dim('（回车跳过）')}: `);
    return ans.trim();
  }

  console.log('');
  console.log(banner('  LLM API Key  ') + dim('（任一即可启用真实流式对话）'));
  envMap.ANTHROPIC_API_KEY = await ask('Anthropic API key', envMap.ANTHROPIC_API_KEY);
  envMap.OPENAI_API_KEY    = await ask('OpenAI API key',    envMap.OPENAI_API_KEY);
  envMap.DEEPSEEK_API_KEY  = await ask('DeepSeek API key',  envMap.DEEPSEEK_API_KEY);

  // 默认值兜底
  envMap.NARRATIVE_BOUNDARY_GLOBAL = envMap.NARRATIVE_BOUNDARY_GLOBAL || '2';
  envMap.ADMIN_TOKEN = envMap.ADMIN_TOKEN || 'admin-dev-token';
  envMap.MOCK_PORT = envMap.MOCK_PORT || '8787';

  if (rl) rl.close();

  writeEnv(envMap);
  console.log(`  ${ok('✓')} 写入 .env`);

  // ─── 3. pnpm install（仅当缺 node_modules） ──────────────────────────
  const nm = join(ROOT, 'node_modules');
  if (!existsSync(nm)) {
    console.log('');
    console.log(`  ${dim('未发现 node_modules/ — 跑 pnpm install ...')}`);
    const r = spawnSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit', shell: true });
    if (r.status !== 0) {
      console.log('\n  pnpm install 失败 — 见上方日志。');
      process.exit(1);
    }
  } else {
    console.log(`  ${ok('✓')} node_modules/ 已存在 — 跳过 pnpm install`);
  }

  // ─── 4. 总结 ────────────────────────────────────────────────────────
  const llmReady = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY']
    .filter((k) => envMap[k] && envMap[k].length > 10);

  console.log('');
  console.log(banner('  下一步  '));
  console.log(`  ${dim('启动:')} ${C.cyan}pnpm dev${C.reset}`);
  console.log(`  ${dim('体检:')} ${C.cyan}pnpm doctor${C.reset}`);
  console.log(`  ${dim('入口:')}`);
  console.log(`    前端:    http://localhost:5173`);
  console.log(`    控制台:  http://localhost:8787/admin  ${dim('(默认 token: ' + envMap.ADMIN_TOKEN + ')')}`);
  if (llmReady.length === 0) {
    console.log(`  ${dim('提示:')} 没填 API key — chat 会跑脚本化 SCRIPT 流，可在控制台 #setup 随时补`);
  } else {
    console.log(`  ${dim('已配置:')} ${ok(llmReady.join(', '))}`);
  }
  console.log('');
}

main().catch((e) => {
  console.error('setup 失败:', e);
  process.exit(1);
});
