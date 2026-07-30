/**
 * 端到端灰度审计：走真实后台 release 路由发布灰度 → 装配 → 验证生效。
 * 证明「灰度发布真的有效」+「模板漏抄全局约束会告警」。
 *   YELAN_STATE_FILE=/tmp/audit-state.json npx tsx scripts/audit-grayscale-e2e.ts
 */
import { adminPromptsRoute } from '../src/routes/admin/prompts';
import { loadBoundaryClause } from '../src/prompts/loader';
import { assembleSystemPrompt } from '../src/prompts/assemble';

process.env.ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin-dev-token';

async function release(body: Record<string, unknown>) {
  const res = await adminPromptsRoute.request('/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.json() as Promise<{ ok: boolean; warning?: string }>;
}

async function main() {
  console.log('■ 1) 发布前 B3 边界（磁盘原文）');
  console.log('   ', loadBoundaryClause(3).replace(/\s+/g, ' ').trim());

  console.log('\n■ 2) 通过真实 /release 路由发布 B3 灰度');
  const r1 = await release({
    key: 'boundary:b3_subtle',
    value: '# Boundary 3 · 暧昧\n\nE2E_GRAYSCALE_B3 —— 这是通过后台发布的新边界文案。',
    reason: 'E2E 审计',
  });
  console.log('    release ok=', r1.ok, ' warning=', r1.warning ?? '(无)');

  console.log('\n■ 3) 发布后 loader 是否读到灰度？');
  const after = loadBoundaryClause(3);
  const took = after.includes('E2E_GRAYSCALE_B3');
  console.log(`    ${took ? '✅ 生效' : '❌ 未生效'}: ${after.replace(/\s+/g, ' ').trim().slice(0, 60)}`);

  console.log('\n■ 4) 灰度内容是否进入最终 system prompt？');
  const prompt = assembleSystemPrompt({ characterId: 'shen-yan-zhi', stage: 'daily', boundary: 3, ifActive: false });
  console.log(`    ${prompt.includes('E2E_GRAYSCALE_B3') ? '✅ 已注入主 prompt' : '❌ 未注入'}`);
  console.log(`    全局约束仍在: ${prompt.includes('非必要不在回答结尾提问') ? '✅' : '❌'}`);

  console.log('\n■ 5) 发布一版「漏抄全局约束」的模板 → 应告警');
  const r2 = await release({
    key: 'system:template',
    value: '{{prelude_card}}\n\n{{character_card}}\n\n{{boundary_clause}}\n\n{{stage_strategy}}\n\n{{atmosphere_block}}',
    reason: 'E2E 审计：漏抄全局约束',
  });
  console.log('    warning=', r2.warning ?? '(无 —— 异常！)');

  console.log('\n审计完成。');
}

main();
