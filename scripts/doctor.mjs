#!/usr/bin/env node
// ============================================================================
// 夜阑 · 体检脚本（doctor）
// ----------------------------------------------------------------------------
// 用法：
//   pnpm doctor          # 跑全部检查
//   pnpm doctor --json   # JSON 输出（CI / 可视化向导吃这个）
//
// 设计原则：
//   1. 零依赖 — 只用 Node 内置模块，新人 clone 后第一秒就能跑
//   2. 无副作用 — 只读、只查、只汇报；任何"修复"都走 setup.mjs
//   3. 退出码：0 = 全绿 / 1 = 有 warn / 2 = 有 fail
//   4. 输出可被解析 — --json 输出与 /api/admin/diagnostics 同 schema
//
// 检查清单（按从基础到具体）：
//   [env]      Node ≥ 20 / pnpm 可用 / 已 pnpm install
//   [files]    .env 是否存在 / packages/prompts 资产 / .local 状态文件
//   [config]   .env 里有没有任意 LLM key / ADMIN_TOKEN / boundary
//   [services] apps/api 是否在跑（探 8787/health）
//   [providers] 已配置的 provider 在 apps/api 内是否 ready（仅 apps/api 在跑时）
//
// 如何加新检查：
//   在 §CHECKS 章节加一项 { id, label, run: async () => ({status, hint}) }
// ============================================================================
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');

// ─── ANSI 颜色（无依赖，且 Windows Terminal/PS7 支持） ─────────────────────
const C = {
  reset: '\x1b[0m', dim: '\x1b[2m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
  cyan: '\x1b[36m', magenta: '\x1b[35m',
};
const ok    = (s) => `${C.green}${s}${C.reset}`;
const warn  = (s) => `${C.yellow}${s}${C.reset}`;
const fail  = (s) => `${C.red}${s}${C.reset}`;
const dim   = (s) => `${C.dim}${s}${C.reset}`;
const bold  = (s) => `${C.bold}${s}${C.reset}`;

// ─── 通用助手 ─────────────────────────────────────────────────────────────
/** 解析 .env 内容为 Record<string,string>；忽略注释 / 空行 */
function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

/** 同步 fetch 一次（短超时），返回 { reachable, status, body } */
async function probe(url, timeoutMs = 1500) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    return { reachable: true, status: res.status, body };
  } catch {
    return { reachable: false, status: 0, body: null };
  }
}

function commandExists(cmd) {
  // Windows: where.exe；其他：which
  const checker = process.platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(checker, [cmd], { stdio: 'ignore' });
  return r.status === 0;
}

// ─── §CHECKS  全部检查项 ─────────────────────────────────────────────────
// 每项必须返回 { id, label, status: 'pass'|'warn'|'fail', hint, fixHint? }
// hint     —— 用户友好的当前结论（一两句话）
// fixHint  —— 怎么修（CLI 命令 / UI 路径），无修复方法可省
const CHECKS = [
  {
    id: 'node-version',
    label: 'Node ≥ 20',
    run() {
      const v = process.versions.node;
      const major = Number(v.split('.')[0]);
      if (major >= 20) return { status: 'pass', hint: `Node ${v}` };
      return {
        status: 'fail',
        hint: `当前 Node ${v}，要求 ≥ 20`,
        fixHint: '装 Node 20+：https://nodejs.org/',
      };
    },
  },
  {
    id: 'pnpm-available',
    label: 'pnpm 可用',
    run() {
      if (commandExists('pnpm')) {
        const v = spawnSync('pnpm', ['--version'], { encoding: 'utf8' });
        return { status: 'pass', hint: `pnpm ${(v.stdout || '').trim()}` };
      }
      return {
        status: 'fail',
        hint: '找不到 pnpm 命令',
        fixHint: 'npm i -g pnpm',
      };
    },
  },
  {
    id: 'deps-installed',
    label: 'pnpm install 是否跑过',
    run() {
      const nm = join(ROOT, 'node_modules');
      if (existsSync(nm)) return { status: 'pass', hint: 'node_modules/ 存在' };
      return {
        status: 'fail',
        hint: '没有 node_modules/',
        fixHint: 'pnpm install',
      };
    },
  },
  {
    id: 'env-file',
    label: '.env 文件',
    run() {
      const envPath = join(ROOT, '.env');
      if (!existsSync(envPath)) {
        return {
          status: 'warn',
          hint: '.env 不存在（可不存在 — 会全靠脚本化 mock 流）',
          fixHint: 'pnpm setup（推荐）  或  copy .env.example .env',
        };
      }
      const size = statSync(envPath).size;
      return { status: 'pass', hint: `.env 存在（${size} 字节）` };
    },
  },
  {
    id: 'env-llm-key',
    label: '至少一个 LLM API key',
    run() {
      const envPath = join(ROOT, '.env');
      const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
      const has = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY']
        .filter((k) => env[k] && env[k].length > 10);
      if (has.length === 0) {
        return {
          status: 'warn',
          hint: '没设置任何 LLM key — chat 会回落到脚本化 SCRIPT 流',
          fixHint: 'pnpm setup  或  控制台 #setup → 填 key',
        };
      }
      return { status: 'pass', hint: `已设：${has.join(', ')}` };
    },
  },
  {
    id: 'admin-token',
    label: 'ADMIN_TOKEN',
    run() {
      const envPath = join(ROOT, '.env');
      const env = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {};
      const t = env.ADMIN_TOKEN || 'admin-dev-token';
      const isDefault = t === 'admin-dev-token';
      return {
        status: isDefault ? 'warn' : 'pass',
        hint: isDefault ? '使用默认值 admin-dev-token（仅本地）' : '已自定义',
        fixHint: isDefault ? '生产请改成强随机值' : undefined,
      };
    },
  },
  {
    id: 'prompts-assets',
    label: 'packages/prompts 资产',
    run() {
      const dir = join(ROOT, 'packages', 'prompts');
      const must = ['characters', 'strategies', 'boundaries', 'system.template.md'];
      const missing = must.filter((p) => !existsSync(join(dir, p)));
      if (missing.length === 0) return { status: 'pass', hint: 'characters/strategies/boundaries 齐' };
      return {
        status: 'fail',
        hint: '缺：' + missing.join(', '),
        fixHint: '检查 packages/prompts 是否完整 clone',
      };
    },
  },
  {
    id: 'api-up',
    label: 'apps/api 是否在跑',
    async run() {
      const port = process.env.MOCK_PORT || 8787;
      const r = await probe(`http://localhost:${port}/health`);
      if (!r.reachable) {
        return {
          status: 'warn',
          hint: `localhost:${port} 不可达（未启动也正常）`,
          fixHint: 'pnpm dev:mock',
        };
      }
      const ready = r.body?.llm?.providers?.filter((p) => p.ready) ?? [];
      return {
        status: 'pass',
        hint: `运行中 · LLM ready: ${ready.length === 0 ? '无（脚本化 mock 流）' : ready.map((p) => p.name).join(', ')}`,
      };
    },
  },
  {
    id: 'web-up',
    label: 'web 前端是否在跑',
    async run() {
      const r = await probe('http://localhost:5173/');
      if (!r.reachable) {
        return {
          status: 'warn',
          hint: 'localhost:5173 不可达（未启动也正常）',
          fixHint: 'pnpm dev:web',
        };
      }
      return { status: 'pass', hint: '运行中' };
    },
  },
  {
    id: 'state-file',
    label: '本地持久化文件',
    run() {
      const f = join(ROOT, 'apps', 'api', '.local', 'state.json');
      if (!existsSync(f)) {
        return {
          status: 'warn',
          hint: '尚无 state.json（首次运行 chat / auth 后自动生成）',
        };
      }
      const size = statSync(f).size;
      return { status: 'pass', hint: `state.json · ${(size / 1024).toFixed(1)} KB` };
    },
  },
];

// ─── 主流程 ──────────────────────────────────────────────────────────────
async function main() {
  const argJson = process.argv.includes('--json');
  const results = [];
  for (const c of CHECKS) {
    let r;
    try { r = await c.run(); }
    catch (e) { r = { status: 'fail', hint: 'check threw: ' + e.message }; }
    results.push({ id: c.id, label: c.label, ...r });
  }

  const summary = {
    pass: results.filter((r) => r.status === 'pass').length,
    warn: results.filter((r) => r.status === 'warn').length,
    fail: results.filter((r) => r.status === 'fail').length,
    total: results.length,
  };

  if (argJson) {
    console.log(JSON.stringify({ ts: new Date().toISOString(), summary, checks: results }, null, 2));
    process.exit(summary.fail > 0 ? 2 : summary.warn > 0 ? 1 : 0);
  }

  console.log('');
  console.log(bold('  夜阑 · 体检报告  ') + dim('(pnpm doctor)'));
  console.log(dim('  ' + '─'.repeat(60)));
  for (const r of results) {
    const icon = r.status === 'pass' ? ok('✓') : r.status === 'warn' ? warn('!') : fail('✗');
    const lab = r.label.padEnd(30);
    console.log(`  ${icon}  ${lab} ${dim(r.hint)}`);
    if (r.fixHint && r.status !== 'pass') {
      console.log(`        ${dim('修复:')} ${C.cyan}${r.fixHint}${C.reset}`);
    }
  }
  console.log(dim('  ' + '─'.repeat(60)));
  console.log(
    `  ${ok(summary.pass + ' 通过')}  ${summary.warn ? warn(summary.warn + ' 警告') : dim('0 警告')}  ${summary.fail ? fail(summary.fail + ' 失败') : dim('0 失败')}`,
  );
  console.log('');

  if (summary.fail > 0) {
    console.log(`  ${fail('▶')} 有失败项，先修复再继续。`);
    process.exit(2);
  } else if (summary.warn > 0) {
    console.log(`  ${warn('▶')} 有警告，但可以继续。${dim('（pnpm setup 可自动修部分项）')}`);
    process.exit(1);
  } else {
    console.log(`  ${ok('▶')} 一切就绪。${dim('跑 pnpm dev 启动；浏览器开 http://localhost:5173 / :8787/admin')}`);
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(fail('体检脚本崩了：'), e);
  process.exit(2);
});
