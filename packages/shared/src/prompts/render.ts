import type { RecallPayload } from '../types/recall';

export interface SystemPromptParams {
  preludeCard: string;
  characterCard: string;
  boundaryClause: string;
  stageStrategy: string;
  /** 每轮动态温度块（含温度行为指引 + 用户画像 + 旧对话概要），由侧袋实时拼好后注入 */
  atmosphereBlock?: string;
  recall?: RecallPayload;
  cutoffWarning?: boolean;
  template: string;
}

const ATMOSPHERE_SLOT = '{{atmosphere_block}}';

export function renderSystemPrompt(params: SystemPromptParams): string {
  const recall = params.recall
    ? `[她记得]\n${params.recall.preferences.slice(0, 10).map((p) => `- ${p.slice(0, 500)}`).join('\n')}\n${params.recall.events
        .slice(0, 10).map((e) => `- ${e.date} ${e.text.slice(0, 500)}`)
        .join('\n')}`
    : '';

  const cutoff = params.cutoffWarning
    ? '[本轮提示]\n当前对话即将自然收束，请在 3-5 轮内引导剧情走向情感悬念点，不可强行结束。'
    : '';

  const atmosphere = params.atmosphereBlock ?? '';

  // 向后兼容：旧模板没有 {{atmosphere_block}} 槽位时，温度块仍按原样追加到尾部，
  // 与历史行为（systemBase + sidecarBlock）一致；新模板有槽位则就地填入。
  const template = params.template.includes(ATMOSPHERE_SLOT) || !atmosphere
    ? params.template
    : `${params.template}\n\n${ATMOSPHERE_SLOT}`;

  return template
    .replace('{{prelude_card}}', params.preludeCard)
    .replace('{{character_card}}', params.characterCard)
    .replace('{{boundary_clause}}', params.boundaryClause)
    .replace('{{stage_strategy}}', params.stageStrategy)
    // 用函数式替换：温度块含用户画像/概要，避免其中的 $&、$$ 等被当成替换模式
    .replace(ATMOSPHERE_SLOT, () => atmosphere)
    .replace('{{recall_block}}', recall)
    .replace('{{cutoff_warning}}', cutoff)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const DEFAULT_TEMPLATE = [
  '{{prelude_card}}',
  '{{character_card}}',
  '{{boundary_clause}}',
  '{{stage_strategy}}',
  '{{recall_block}}',
  '{{cutoff_warning}}',
  '{{atmosphere_block}}',
].join('\n\n');

export function renderSystemPromptSimple(params: Omit<SystemPromptParams, 'template'>): string {
  return renderSystemPrompt({ ...params, template: DEFAULT_TEMPLATE });
}
