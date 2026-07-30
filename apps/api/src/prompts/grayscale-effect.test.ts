// 验证「Prompt 灰度」发布是否真正生效（临时方案一：loader 回读 prompts.versions）
// 以及不会破坏现有装配体验（无版本时回退文件、未生效版本被忽略、全局约束不丢失）。
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import {
  loadBoundaryClause,
  loadStrategyForStage,
  getSystemTemplate,
  resetPromptCache,
} from './loader';
import { assembleSystemPrompt } from './assemble';

let versionSeq = 0;

/** 直接写一条「生效中」灰度版本到 store（模拟后台 release 后的状态） */
function publish(key: string, value: string, active = true) {
  const id = `pv_test_${versionSeq++}`;
  store.state().prompts.versions.push({
    id,
    key,
    value,
    activeAt: active ? new Date().toISOString() : null,
    createdAt: new Date().toISOString(),
  });
  return id;
}

describe('灰度发布是否真正生效（loader 回读 prompts.versions）', () => {
  beforeEach(() => {
    store.__resetForTests();
    resetPromptCache();
  });
  afterEach(() => {
    resetPromptCache();
  });

  it('边界条款：发布生效版本后 loadBoundaryClause 返回灰度内容', () => {
    const fileValue = loadBoundaryClause(3); // 无灰度时的磁盘原文
    publish('boundary:b3_subtle', 'GRAYSCALE_B3_MARKER 暧昧档新文案');
    expect(loadBoundaryClause(3)).toBe('GRAYSCALE_B3_MARKER 暧昧档新文案');
    expect(loadBoundaryClause(3)).not.toBe(fileValue);
  });

  it('阶段策略：发布生效版本后 loadStrategyForStage 返回灰度内容', () => {
    publish('strategy:stage_daily', 'GRAYSCALE_DAILY_MARKER 日常策略新文案');
    expect(loadStrategyForStage('daily')).toBe('GRAYSCALE_DAILY_MARKER 日常策略新文案');
  });

  it('系统模板：发布生效版本后 getSystemTemplate 返回灰度内容', () => {
    const tpl = '{{prelude_card}}\n\n{{character_card}}\n\n{{boundary_clause}}\n\n'
      + '{{stage_strategy}}\n\nGRAYSCALE_TPL_MARKER\n\n{{atmosphere_block}}';
    publish('system:template', tpl);
    expect(getSystemTemplate()).toBe(tpl);
  });

  it('灰度内容真的进入最终装配的 system prompt', () => {
    publish('boundary:b2_restrained', 'B2_INJECTED_MARKER');
    publish('strategy:stage_rise', 'RISE_INJECTED_MARKER');
    const prompt = assembleSystemPrompt({
      characterId: 'shen-yan-zhi',
      stage: 'rise',
      boundary: 2,
      ifActive: false,
    });
    expect(prompt).toContain('B2_INJECTED_MARKER');
    expect(prompt).toContain('RISE_INJECTED_MARKER');
  });
});

describe('不破坏体验：回退与隔离', () => {
  beforeEach(() => {
    store.__resetForTests();
    resetPromptCache();
  });
  afterEach(() => {
    resetPromptCache();
  });

  it('无灰度版本时回退磁盘文件（非空、含标题）', () => {
    expect(loadBoundaryClause(3)).toContain('Boundary 3');
    expect(loadStrategyForStage('daily')).toContain('daily');
    expect(getSystemTemplate()).toContain('{{atmosphere_block}}');
  });

  it('未生效版本（activeAt=null）被忽略，仍回退磁盘', () => {
    const fileValue = loadBoundaryClause(4);
    publish('boundary:b4_explicit', 'DRAFT_NOT_ACTIVE', false); // 草稿，未激活
    expect(loadBoundaryClause(4)).toBe(fileValue);
    expect(loadBoundaryClause(4)).not.toContain('DRAFT_NOT_ACTIVE');
  });

  it('某段灰度不影响其它段（B3 覆盖不动 B2）', () => {
    const b2File = loadBoundaryClause(2);
    publish('boundary:b3_subtle', 'ONLY_B3');
    expect(loadBoundaryClause(2)).toBe(b2File); // B2 仍走文件
    expect(loadBoundaryClause(3)).toBe('ONLY_B3');
  });

  it('灰度模板不吞掉写死的 [全局表达约束]（除非管理员自己删）', () => {
    // 不发布模板灰度时，全局约束必须在
    const normal = assembleSystemPrompt({
      characterId: 'shen-yan-zhi', stage: 'daily', boundary: 3, ifActive: false,
    });
    expect(normal).toContain('非必要不在回答结尾提问');
  });

  it('空串灰度是有效覆盖（管理员有意清空某段）', () => {
    publish('strategy:stage_after', '');
    expect(loadStrategyForStage('after')).toBe('');
  });
});
