import { describe, expect, it } from 'vitest';
import { renderSystemPrompt } from './render';

const BASE = {
  preludeCard: '',
  characterCard: 'CHAR',
  boundaryClause: 'BOUNDARY',
  stageStrategy: 'STRATEGY',
};

describe('renderSystemPrompt atmosphere block', () => {
  it('fills the {{atmosphere_block}} slot in place when the template declares it', () => {
    const template = '{{character_card}}\n\n{{atmosphere_block}}\n\n{{stage_strategy}}';
    const out = renderSystemPrompt({
      ...BASE,
      atmosphereBlock: '[当前温度：3]',
      template,
    });

    // 槽位被就地替换：温度块落在角色卡与阶段策略之间，而不是尾部
    expect(out).toBe('CHAR\n\n[当前温度：3]\n\nSTRATEGY');
  });

  it('falls back to tail-append when the template has no {{atmosphere_block}} slot (legacy template)', () => {
    const legacy = '{{character_card}}\n\n{{stage_strategy}}';
    const out = renderSystemPrompt({
      ...BASE,
      atmosphereBlock: '[当前温度：3]',
      template: legacy,
    });

    // 旧模板没有槽位时，行为与历史一致：温度块追加到尾部
    expect(out).toBe('CHAR\n\nSTRATEGY\n\n[当前温度：3]');
  });

  it('renders a legacy template unchanged when no atmosphere block is supplied', () => {
    const legacy = '{{character_card}}\n\n{{stage_strategy}}';
    const out = renderSystemPrompt({ ...BASE, template: legacy });

    // 无温度块 + 旧模板：不追加任何空槽位
    expect(out).toBe('CHAR\n\nSTRATEGY');
  });

  it('collapses the slot to nothing when the new template declares it but no block is supplied', () => {
    const template = '{{character_card}}\n\n{{atmosphere_block}}\n\n{{stage_strategy}}';
    const out = renderSystemPrompt({ ...BASE, template });

    expect(out).toBe('CHAR\n\nSTRATEGY');
  });
});
