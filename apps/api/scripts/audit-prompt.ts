/**
 * 对话实测审计 —— 装配审计版（确定性，不依赖外部 LLM）。
 *
 * 用真实角色数据装配主 AI 每轮的 system prompt，逐段体检：
 *  - 每个槽位是否有内容、内容是什么
 *  - 灰度覆盖是否生效（对比发布前后）
 *  - 全局约束 / 反八股 是否还在
 *
 * 用法（在 apps/api 下）：
 *   YELAN_STATE_FILE=/tmp/audit-state.json npx tsx scripts/audit-prompt.ts <characterId> <stage> <boundary>
 * 默认 shen-yan-zhi / daily / 3。
 */
import { store } from '../src/store/persistence';
import { assembleSystemPrompt } from '../src/prompts/assemble';
import { loadBoundaryClause, loadStrategyForStage, getSystemTemplate } from '../src/prompts/loader';

const [, , charArg, stageArg, boundaryArg] = process.argv;
const characterId = charArg || 'shen-yan-zhi';
const stage = (stageArg || 'daily') as any;
const boundary = Number(boundaryArg || 3) as 1 | 2 | 3 | 4 | 5;

function hr(title: string) {
  console.log('\n' + '─'.repeat(60));
  console.log('■ ' + title);
  console.log('─'.repeat(60));
}

const s = store.state();
const char = s.characters[characterId];
console.log(`角色: ${char?.name ?? '(未找到)'} [${characterId}]  阶段: ${stage}  边界: B${boundary}`);
console.log(`灰度版本(生效中): ${s.prompts.versions.filter((v) => v.activeAt).map((v) => v.key).join(', ') || '无'}`);

hr('分段体检');
const segs: Array<[string, string]> = [
  ['boundary_clause', loadBoundaryClause(boundary)],
  ['stage_strategy', loadStrategyForStage(stage)],
];
for (const [name, val] of segs) {
  const flat = val.replace(/\s+/g, ' ').trim();
  const isTodo = /TODO/i.test(val);
  const tag = !flat ? '⚠️ 空' : isTodo ? '⚠️ TODO占位' : '✅';
  console.log(`  ${tag} ${name} (${flat.length}字): ${flat.slice(0, 80)}${flat.length > 80 ? '…' : ''}`);
}
console.log(`  system_template 首行: ${getSystemTemplate().split('\n')[0]}`);

hr('完整装配 system prompt');
const prompt = assembleSystemPrompt({
  characterId,
  stage,
  boundary,
  ifActive: false,
  recall: { preferences: ['喜欢在深夜聊天'], events: [{ date: '2026-07-01', text: '第一次见面' }] } as any,
  atmosphereBlock: '[温度块] 当前温度：温和试探，可轻微靠近。',
});
console.log(prompt);

hr('关键约束存活检查');
const checks: Array<[string, boolean]> = [
  ['[全局表达约束] 少结尾提问', prompt.includes('非必要不在回答结尾提问')],
  ['[反八股] 规范', prompt.includes('反八股')],
  ['前置卡(daily-default)', prompt.includes('日常前置提示卡') || prompt.includes('前置提示卡')],
  ['角色卡标题', prompt.includes('# 角色')],
  ['温度块注入', prompt.includes('[温度块]')],
  ['她记得(recall)', prompt.includes('[她记得]')],
];
for (const [name, ok] of checks) console.log(`  ${ok ? '✅' : '❌'} ${name}`);
console.log('\n审计完成。');
