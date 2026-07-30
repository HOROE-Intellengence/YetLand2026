// 诊断聚合 — 给可视化向导吃，schema 与 scripts/doctor.mjs --json 对齐
// 后台 #setup 面板调本接口绘制检查清单
import { Hono } from 'hono';
import { DEFAULT_GLOBAL_BOUNDARY } from '@yelan/shared';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { store } from '../../store/persistence';
import { getRouter, resetRouter } from '../../llm/create-router';
import { clearFlagCache, FEATURE_FLAGS, flag } from '../../config/feature-flags';
import { getDeployMode } from '../../config/deploy-mode';
import { resetPromptCache } from '../../prompts/loader';

export const adminDiagnosticsRoute = new Hono();

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/routes/admin → repo root
const ROOT = resolve(here, '..', '..', '..', '..', '..');
const ENV_ROOT = join(ROOT, '.env');
const ENV_APP  = resolve(here, '..', '..', '..', '.env'); // apps/api/.env

interface Check {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  hint: string;
  fixHint?: string;
  /** 可视化向导能直接调的 admin 接口路径 — 让前端做"一键修复" */
  fix?: { method: 'POST'; path: string; body?: unknown };
}

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

adminDiagnosticsRoute.get('/', (c) => {
  const checks: Check[] = [];

  // ── 1. .env 文件 ───────────────────────────────────────────────────────
  const rootEnv = parseEnvFile(ENV_ROOT);
  const appEnv = parseEnvFile(ENV_APP);
  const hasEnv = existsSync(ENV_ROOT) || existsSync(ENV_APP);
  checks.push({
    id: 'env-file',
    label: '.env 文件',
    status: hasEnv ? 'pass' : 'warn',
    hint: hasEnv
      ? `已存在：${[ENV_ROOT, ENV_APP].filter(existsSync).map((p) => p.replace(ROOT, '.')).join(', ')}`
      : '未发现 .env（chat 会跑脚本化 SCRIPT 流）',
    fixHint: hasEnv ? undefined : '运行 pnpm setup 自动创建',
  });

  // ── 2. LLM API key ─────────────────────────────────────────────────────
  // Router is the source of truth because it includes API inventory entries.
  const router = getRouter();
  const ready = Array.from(router.providers.entries()).filter(([, p]) => p.ready).map(([n]) => n);

  const llmKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'NVIDIA_API_KEY'];
  const setKeys = llmKeys.filter((k) => process.env[k] && process.env[k]!.length > 10);
  checks.push({
    id: 'env-llm-key',
    label: '至少一个 LLM API key',
    status: ready.length === 0 ? 'warn' : 'pass',
    hint: ready.length === 0
      ? '当前没有 ready 的 provider — chat 走脚本化流'
      : '已就绪：' + ready.join(', ') + (setKeys.length ? `（环境变量：${setKeys.join(', ')}）` : ''),
    fixHint: ready.length === 0 ? '在 #llm / API 仓库添加 key，或在 #config 写入 env key' : undefined,
  });

  // ── 3. ADMIN_TOKEN 是否仍为默认 ────────────────────────────────────────
  const token = process.env.ADMIN_TOKEN || 'admin-dev-token';
  const isDefault = token === 'admin-dev-token';
  checks.push({
    id: 'admin-token',
    label: 'ADMIN_TOKEN',
    status: isDefault ? 'warn' : 'pass',
    hint: isDefault ? '使用默认 admin-dev-token（仅本地）' : '已自定义',
  });

  // ── 4. NARRATIVE_BOUNDARY_GLOBAL ───────────────────────────────────────
  const boundary = Number(process.env.NARRATIVE_BOUNDARY_GLOBAL ?? DEFAULT_GLOBAL_BOUNDARY);
  checks.push({
    id: 'boundary',
    label: '全局合规边界',
    status: 'pass',
    hint: `当前 ${boundary} / 5（1=纯净 5=直白）`,
  });

  // ── 5. LLM provider ready ──────────────────────────────────────────────
  checks.push({
    id: 'llm-ready',
    label: 'LLM provider 就绪',
    status: ready.length === 0 ? 'warn' : 'pass',
    hint: ready.length === 0 ? '0 个 provider ready' : `${ready.length} 个 ready: ${ready.join(', ')}`,
    fixHint: ready.length === 0 ? '#llm 面板可一键测试 / #config 面板可写入 key' : undefined,
  });

  // ── 6. 持久化文件 ───────────────────────────────────────────────────────
  const stateFile = resolve(here, '..', '..', '..', '.local', 'state.json');
  const stateExists = existsSync(stateFile);
  const stateSize = stateExists ? statSync(stateFile).size : 0;
  const userCount = Object.keys(store.state().users).length;
  checks.push({
    id: 'state-file',
    label: '持久化文件',
    status: 'pass',
    hint: stateExists ? `state.json · ${(stateSize / 1024).toFixed(1)}KB · ${userCount} 用户` : '内存中（尚未落盘）',
  });

  // ── 7. Prompt 资产 ─────────────────────────────────────────────────────
  const promptDir = resolve(ROOT, 'packages', 'prompts');
  const must = ['characters', 'strategies', 'boundaries', 'system.template.md'];
  const missing = must.filter((p) => !existsSync(join(promptDir, p)));
  checks.push({
    id: 'prompts-assets',
    label: 'packages/prompts 资产',
    status: missing.length === 0 ? 'pass' : 'fail',
    hint: missing.length === 0 ? '齐' : '缺：' + missing.join(', '),
  });

  // ── 8. 示例数据 ────────────────────────────────────────────────────────
  const hasSeed = userCount >= 2;
  checks.push({
    id: 'seed-data',
    label: '示例数据',
    status: hasSeed ? 'pass' : 'warn',
    hint: hasSeed ? `${userCount} 用户、${store.state().ifCodes.length} 暗号` : '尚未灌示例数据',
    fixHint: hasSeed ? undefined : '点 #setup 的"灌示例"按钮 / pnpm seed',
    fix: hasSeed ? undefined : { method: 'POST', path: '/api/admin/seed', body: { reason: 'one-click setup' } },
  });

  const summary = {
    pass: checks.filter((x) => x.status === 'pass').length,
    warn: checks.filter((x) => x.status === 'warn').length,
    fail: checks.filter((x) => x.status === 'fail').length,
    total: checks.length,
  };

  return c.json({
    ts: new Date().toISOString(),
    summary,
    checks,
    // 给可视化向导用的快捷 actions（按钮 → admin endpoint）
    quickActions: [
      { id: 'reload-config', label: '重载配置', method: 'POST', path: '/api/admin/diagnostics/reload-config' },
      { id: 'test-all-llm', label: '测试所有 LLM', method: 'POST', path: '/api/admin/diagnostics/test-all' },
      { id: 'seed',          label: '灌示例数据',   method: 'POST', path: '/api/admin/seed', body: { reason: 'wizard' } },
      { id: 'reset-seed',    label: '清空 + 重灌',  method: 'POST', path: '/api/admin/seed', body: { reset: true, reason: 'wizard' } },
    ],
  });
});

/** 把所有 ready 的 provider 各试一次 */
adminDiagnosticsRoute.post('/test-all', async (c) => {
  const router = getRouter();
  const out: Array<{ name: string; ready: boolean; ok?: boolean; latencyMs?: number; sample?: string; error?: string }> = [];
  for (const [name, p] of router.providers.entries()) {
    if (!p.ready) {
      out.push({ name, ready: false });
      continue;
    }
    try {
      const t0 = Date.now();
      const r = await p.complete({
        model: '',
        messages: [
          { role: 'system', content: '一句话回答' },
          { role: 'user', content: '在吗？' },
        ],
        maxTokens: 32,
      });
      out.push({ name, ready: true, ok: true, latencyMs: Date.now() - t0, sample: r.text.slice(0, 60) });
    } catch (e) {
      out.push({ name, ready: true, ok: false, error: (e as Error).message });
    }
  }
  return c.json({ results: out });
});

/** 剥掉值两端成对引号 —— 与 bootstrap-env 的解析行为对齐 */
function stripQuotes(v: string): string {
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * 配置重载 —— 重新读 .env + 清 flag 缓存 + 重建 router，不重启进程。
 * 解决 flag 缓存无失效 / 改 .env 必须重启 的痛点。
 */
adminDiagnosticsRoute.post('/reload-config', (c) => {
  // 1. 重载前 flag 快照
  const before: Record<string, boolean> = {};
  for (const f of Object.values(FEATURE_FLAGS)) before[f] = flag(f);

  // 2. 重新解析 .env → process.env（app 覆盖 root，与 bootstrap-env 同序）
  const merged = { ...parseEnvFile(ENV_ROOT), ...parseEnvFile(ENV_APP) };
  let envApplied = 0;
  for (const [k, raw] of Object.entries(merged)) {
    const v = stripQuotes(raw);
    if (process.env[k] !== v) {
      process.env[k] = v;
      envApplied++;
    }
  }

  // 3. 清 flag 缓存 + 重建 router + 清提示资产缓存（模板/策略/边界，懒加载重读）
  clearFlagCache();
  resetRouter();
  resetPromptCache();

  // 4. 重载后快照 + 算 diff
  const after: Record<string, boolean> = {};
  for (const f of Object.values(FEATURE_FLAGS)) after[f] = flag(f);
  const flagChanges = Object.keys(after)
    .filter((f) => before[f] !== after[f])
    .map((f) => ({ flag: f, from: before[f], to: after[f] }));

  const router = getRouter();
  const readyProviders = Array.from(router.providers.entries())
    .filter(([, p]) => p.ready)
    .map(([n]) => n);

  return c.json({
    ok: true,
    envApplied,
    flagChanges,
    readyProviders,
    ts: new Date().toISOString(),
  });
});

/**
 * 关停后端进程 —— 测试收尾用：一键停服，避免遗留进程占端口。
 * 注意：dev 跑在 `tsx watch` 下，watcher 会在子进程退出后立刻重启它。
 *      所以先杀父进程（tsx watch / pnpm），再退自己，确保不被拉起。
 *      父进程是 watcher，不是用户终端（终端在更上层），故不会误关终端。
 * 仅 local 模式可用 —— 防止生产环境误触把服务打死。
 */
adminDiagnosticsRoute.post('/shutdown', (c) => {
  if (getDeployMode() !== 'local') {
    return c.json({ code: 'FORBIDDEN', message: 'shutdown 仅在 local 模式可用' }, 403);
  }
  const pid = process.pid;
  const ppid = process.ppid;
  // 先把响应发回前端，再异步退出（留时间给 HTTP flush）
  setTimeout(() => {
    try {
      // 杀父进程（tsx watch / pnpm），否则 watcher 会立刻重启本进程
      if (ppid && ppid > 1) process.kill(ppid);
    } catch {
      /* 父进程可能已退出或无权限，忽略 —— 下面照样退自己 */
    }
    process.exit(0);
  }, 250);
  return c.json({ ok: true, message: '后端进程即将关停', pid, ppid });
});
