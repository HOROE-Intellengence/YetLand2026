import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../store/persistence';
import { adminPromptsRoute } from './prompts';

async function release(body: Record<string, unknown>) {
  return adminPromptsRoute.request('/release', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('admin prompts release — system template slot warning', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('returns a warning (without blocking) when the system template drops the temperature slot', async () => {
    const res = await release({
      key: 'system:template',
      // 后台误删了 {{atmosphere_block}}，只留下边界槽位
      value: '{{character_card}}\n\n{{boundary_clause}}\n\n{{stage_strategy}}',
      reason: '误删温度槽位',
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; warning?: string };
    expect(json.ok).toBe(true);
    // 仍然保存成功（不阻断）
    expect(store.state().prompts.versions.at(-1)).toMatchObject({ key: 'system:template' });
    // 但带回缺槽位告警
    expect(json.warning).toBeTruthy();
    expect(json.warning).toContain('温度');
    expect(json.warning).toContain('{{atmosphere_block}}');
  });

  it('omits the warning when the system template carries both slots and global anchors', async () => {
    const res = await release({
      key: 'system:template',
      value: '{{character_card}}\n\n{{boundary_clause}}\n\n{{stage_strategy}}\n\n{{atmosphere_block}}'
        + '\n\n[全局表达约束]\n非必要不在回答结尾提问。\n\n[反八股 · 去模板化写作规范]\n...',
      reason: '完整模板',
    });

    const json = (await res.json()) as { ok: boolean; warning?: string };
    expect(json.ok).toBe(true);
    expect(json.warning).toBeUndefined();
  });

  it('warns when the system template drops the hardcoded global constraints (anchors)', async () => {
    const res = await release({
      key: 'system:template',
      // 槽位齐全，但整段模板漏抄了写死的全局约束 / 反八股
      value: '{{prelude_card}}\n\n{{character_card}}\n\n{{boundary_clause}}\n\n'
        + '{{stage_strategy}}\n\n{{recall_block}}\n\n{{cutoff_warning}}\n\n{{atmosphere_block}}',
      reason: '整段替换模板但漏抄全局约束',
    });

    expect(res.status).toBe(200);
    const json = (await res.json()) as { ok: boolean; warning?: string };
    expect(json.ok).toBe(true);
    // 保存不阻断
    expect(store.state().prompts.versions.at(-1)).toMatchObject({ key: 'system:template' });
    // 但告警点名两条全局约束
    expect(json.warning).toBeTruthy();
    expect(json.warning).toContain('全局约束');
    expect(json.warning).toContain('少结尾提问');
    expect(json.warning).toContain('反八股');
    // 槽位齐全时不应误报槽位缺失
    expect(json.warning).not.toContain('必需槽位');
  });

  it('warns for both missing slots and missing anchors together', async () => {
    const res = await release({
      key: 'system:template',
      value: '{{character_card}}\n\n{{stage_strategy}}', // 缺 温度+边界槽位，也缺全局约束
      reason: '空模板',
    });
    const json = (await res.json()) as { ok: boolean; warning?: string };
    expect(json.warning).toContain('必需槽位');
    expect(json.warning).toContain('全局约束');
  });

  it('never warns for non-system prompt keys', async () => {
    const res = await release({
      key: 'boundary:b3_subtle',
      value: 'whatever the editor typed',
      reason: '改边界文案',
    });

    const json = (await res.json()) as { ok: boolean; warning?: string };
    expect(json.ok).toBe(true);
    expect(json.warning).toBeUndefined();
  });
});
