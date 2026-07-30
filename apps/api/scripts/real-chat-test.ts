/**
 * 真实对话实测（走 LLM，验证输出质量）。
 *   YELAN_STATE_FILE=/tmp/audit-state.json npx tsx scripts/real-chat-test.ts
 * 仅跑一轮，验证 Stage 1 填入的边界/策略内容是否真正影响输出质量。
 */
import { getRouter } from '../src/llm/create-router';
import { assembleSystemPrompt } from '../src/prompts/assemble';

async function main() {
  const router = getRouter();
  if (!router.hasReady()) {
    console.log('❌ 无可用 LLM 配置，跳过真实对话测试。');
    return;
  }

  const systemPrompt = assembleSystemPrompt({
    characterId: 'shen-yan-zhi',
    stage: 'daily',
    boundary: 3,
    ifActive: false,
  });

  const userMsg = '今晚有空吗？一起出来坐坐？';
  console.log(`用户: ${userMsg}\n`);
  process.stdout.write('沈砚之 (B3/daily): ');

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    { role: 'user' as const, content: userMsg },
  ];

  let fullReply = '';
  for await (const chunk of router.stream('daily', { model: '', messages, reasoningEffort: 'low' }, undefined, () => {}) as AsyncIterable<{ text?: string }>) {
    if (chunk.text) {
      process.stdout.write(chunk.text);
      fullReply += chunk.text;
    }
  }
  console.log('\n');
  console.log('─'.repeat(60));
  console.log('■ 输出质量体检:');
  console.log(`  长度: ${fullReply.length} 字`);
  console.log(`  有无 TODO 泄露: ${fullReply.includes('TODO') ? '❌ 有' : '✅ 无'}`);
  console.log(`  有无「宝贝」禁用语: ${fullReply.includes('宝贝') ? '❌ 有' : '✅ 无'}`);
  console.log(`  有无八股词(不禁/忍不住): ${/不禁|忍不住/.test(fullReply) ? '⚠️ 有' : '✅ 无'}`);
  console.log(`  结尾是否提问: ${fullReply.trim().endsWith('？') || fullReply.trim().endsWith('?') ? '⚠️ 是' : '✅ 否'}`);
  console.log('\n实测完成。如输出质量 OK，Stage 1 通过。');
}

main();
