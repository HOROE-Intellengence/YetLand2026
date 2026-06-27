// 加载顺序: KV(灰度) → @yelan/prompts(构建期烘出来的默认值)
// 改 yaml/md 后要重新 build prompts 包，否则默认值不会更新
import type { Env } from '../types/bindings';
import {
  characters as defaultCharacters,
  strategies as defaultStrategies,
  boundaries as defaultBoundaries,
} from '@yelan/prompts';

export async function loadCharacterCard(env: Env, characterId: string): Promise<string> {
  if (env.PROMPTS_KV) {
    const kv = await env.PROMPTS_KV.get(`character:${characterId}`);
    if (kv) return kv;
  }
  const card = defaultCharacters[characterId];
  if (!card) return '';
  // yaml → system prompt 段的具体格式由 Prompt 工程师定，这里是兜底拼接
  return `# ${card.name}\n${card.description ?? ''}\n禁用语: ${card.voice?.forbidden_phrases?.join(', ') ?? '-'}`;
}

export async function loadStrategyForStage(env: Env, stage: string): Promise<string> {
  if (env.PROMPTS_KV) {
    const kv = await env.PROMPTS_KV.get(`strategy:${stage}`);
    if (kv) return kv;
  }
  return defaultStrategies[`stage_${stage}`] ?? '';
}

export async function loadBoundaryClause(env: Env, level: 1 | 2 | 3 | 4 | 5): Promise<string> {
  if (env.PROMPTS_KV) {
    const kv = await env.PROMPTS_KV.get(`boundary:${level}`);
    if (kv) return kv;
  }
  const slugMap: Record<1 | 2 | 3 | 4 | 5, string> = {
    1: 'b1_pure', 2: 'b2_restrained', 3: 'b3_subtle', 4: 'b4_explicit', 5: 'b5_direct',
  };
  return defaultBoundaries[slugMap[level]] ?? '';
}
