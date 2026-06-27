#!/usr/bin/env node
// ============================================================================
// 夜阑 · 一键灌示例数据（seed-data）
// ----------------------------------------------------------------------------
// 用法：
//   pnpm seed                # 调 apps/api，建 3 个用户 + 烛账记录 + 一条暗号
//   pnpm seed --reset        # 先调 admin/seed?reset=1（清当前数据再灌）
//
// 设计：HTTP 调 admin 接口而非直接写 state.json — 避免和运行中进程内存不一致
// 前置：apps/api 必须在跑（pnpm dev:mock）
// ============================================================================
const BASE = process.env.MOCK_BASE || 'http://localhost:8787';
const TOKEN = process.env.ADMIN_TOKEN || 'admin-dev-token';

const C = { reset: '\x1b[0m', red: '\x1b[31m', green: '\x1b[32m', dim: '\x1b[2m', cyan: '\x1b[36m' };
const ok = (s) => `${C.green}${s}${C.reset}`;
const fail = (s) => `${C.red}${s}${C.reset}`;
const dim = (s) => `${C.dim}${s}${C.reset}`;

async function adminPost(path, body) {
  const res = await fetch(BASE + '/api/admin' + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`POST ${path} → ${res.status} ${text}`);
  }
  return res.json();
}

async function main() {
  const reset = process.argv.includes('--reset');
  console.log(dim('  连 ' + BASE + ' ...'));

  // 体检
  try {
    const h = await fetch(BASE + '/health');
    if (!h.ok) throw new Error('health not ok');
  } catch (e) {
    console.log(fail('  ✗ apps/api 不可达 — 先跑 pnpm dev:mock'));
    process.exit(1);
  }

  if (reset) {
    await adminPost('/seed', { reset: true, reason: 'pnpm seed --reset' });
    console.log(ok('  ✓ 已 reset 持久化数据'));
  }

  // 一键灌：用 admin/seed 的内置规则
  const r = await adminPost('/seed', { reason: 'pnpm seed' });
  console.log(ok(`  ✓ 已灌入 ${r.created.users} 用户 / ${r.created.codes} 暗号 / ${r.created.payments} 支付样例`));
  console.log('');
  console.log(dim('  下一步：浏览器打开 http://localhost:8787/admin → 用户 / 暗号 / 烛账面板查看'));
  console.log('');
}

main().catch((e) => {
  console.error(fail('  ✗ ' + e.message));
  process.exit(1);
});
