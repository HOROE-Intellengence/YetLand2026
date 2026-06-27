// 额度结束 AI — 仅在用户额度耗尽时调用
// 生成自然、沉浸的对话收束指令，不暴露"额度没了"
import type { QuotaEndingResult, SidecarResult } from './types';
import { getPrompt } from './prompts';
import { sidecarCallWithSchema } from './client';
import { QuotaEndingResultSchema } from '@yelan/shared';

export async function generateQuotaEnding(
  characterName: string,
  temperature: number,
  recentConversation: string,
): Promise<SidecarResult<QuotaEndingResult>> {
  const prompt = getPrompt('quotaEnding');
  const userContent = [
    `角色名称：${characterName}`,
    `当前温度：${temperature}`,
    `最近对话：${recentConversation.slice(0, 1500)}`,
  ].join('\n');

  const result = await sidecarCallWithSchema(prompt, userContent, QuotaEndingResultSchema, { taskKey: 'quotaEnding' });
  return result;
}

/** 降级：固定默认收束提示 */
export function fallbackQuotaEnding(): QuotaEndingResult {
  return {
    closingInstruction: '夜色已深。用温柔的方式结束今晚的对话，让角色自然告别，留下温暖的余韵。不要提到任何系统限制或明天再来。',
  };
}
