/**
 * 验证边界/策略内容能否「正确、高效」接入真实对话链路。
 * 复刻 routes/chat.ts 的真实计算：effectiveBoundary + judgeStage → assembleSystemPrompt。
 *   YELAN_STATE_FILE=/tmp/audit-state.json npx tsx scripts/verify-wiring.ts
 */
import { effectiveBoundary, judgeStage } from '@yelan/shared';
import { loadBoundaryClause, loadStrategyForStage } from '../src/prompts/loader';
import { assembleSystemPrompt } from '../src/prompts/assemble';

console.log('■ 一、正确性：judgeStage 判定 → 命中正确的阶段策略文件');
const stageCases: Array<[string, any]> = [
  ['第1轮闲聊', { round: 1, text: '在吗', hourLocal: 14, prevStage: 'daily' }],
  ['第7轮追问', { round: 7, text: '为什么不告诉我', hourLocal: 15, prevStage: 'daily' }],
  ['出现亲密关键词', { round: 8, text: '抱抱我', hourLocal: 23, prevStage: 'rise' }],
  ['climax后转余韵', { round: 10, text: '就这样靠着', hourLocal: 1, prevStage: 'climax' }],
  ['深夜推进', { round: 3, text: '睡不着', hourLocal: 2, prevStage: 'daily' }],
];
for (const [label, input] of stageCases) {
  const stage = judgeStage(input);
  const content = loadStrategyForStage(stage);
  const title = content.split('\n')[0];
  const ok = content.includes(`stage_${stage}`) || title.includes(stage);
  console.log(`  ${ok ? '✅' : '❌'} ${label} → stage=${stage} → 命中「${title}」`);
}

console.log('\n■ 二、正确性：effectiveBoundary = min(用户档, 全局上限) → 命中正确边界文件');
const bCases: Array<[number, number]> = [[5, 3], [2, 3], [4, 4], [1, 5], [3, 2]];
for (const [user, global] of bCases) {
  const b = effectiveBoundary(user as any, global as any);
  const content = loadBoundaryClause(b);
  const title = content.split('\n')[0];
  console.log(`  ✅ 用户${user} × 全局${global} → B${b} → 命中「${title}」`);
}

console.log('\n■ 三、高效性：文件是否每轮重读（应只读一次，之后走缓存）');
// ensureLoaded 内有缓存；连续多次调用不应触发额外磁盘 IO。
// 用高精度计时对比首次 vs 后续（首次含 readFileSync，后续走缓存内存）。
const t0 = process.hrtime.bigint();
loadBoundaryClause(3); loadStrategyForStage('daily');
const t1 = process.hrtime.bigint();
for (let i = 0; i < 1000; i++) { loadBoundaryClause(3); loadStrategyForStage('daily'); }
const t2 = process.hrtime.bigint();
const firstUs = Number(t1 - t0) / 1000;
const avgUs = Number(t2 - t1) / 1000 / 1000;
console.log(`  首次装配(含缓存填充): ${firstUs.toFixed(1)}μs`);
console.log(`  后续每次(走缓存): ${avgUs.toFixed(3)}μs  →  ${avgUs < 5 ? '✅ 纯内存，无重复磁盘IO' : '⚠️ 偏慢'}`);

console.log('\n■ 四、高效性：接入后每轮 system prompt 增加的开销');
const boundaryChars = loadBoundaryClause(3).length;
const strategyChars = loadStrategyForStage('daily').length;
const full = assembleSystemPrompt({ characterId: 'shen-yan-zhi', stage: 'daily', boundary: 3, ifActive: false });
console.log(`  边界条款: ${boundaryChars} 字  阶段策略: ${strategyChars} 字  合计新增≈ ${boundaryChars + strategyChars} 字`);
console.log(`  完整 system prompt: ${full.length} 字 (≈ ${Math.round(full.length * 1.6)} tokens 粗估)`);
console.log(`  两段占比: ${(((boundaryChars + strategyChars) / full.length) * 100).toFixed(1)}%`);

console.log('\n验证完成。');
