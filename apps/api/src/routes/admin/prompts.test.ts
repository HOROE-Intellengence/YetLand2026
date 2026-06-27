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

  it('omits the warning when the system template carries both required slots', async () => {
    const res = await release({
      key: 'system:template',
      value: '{{character_card}}\n\n{{boundary_clause}}\n\n{{stage_strategy}}\n\n{{atmosphere_block}}',
      reason: '完整模板',
    });

    const json = (await res.json()) as { ok: boolean; warning?: string };
    expect(json.ok).toBe(true);
    expect(json.warning).toBeUndefined();
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
