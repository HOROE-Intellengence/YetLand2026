import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixtures = vi.hoisted(() => ({
  savePresets: vi.fn(), saveWorldBooks: vi.fn(), saveRegexes: vi.fn(), saveBindings: vi.fn(), inspection: vi.fn(),
  bindings: { globalDefaults: { apiConfigId: 'old-api' }, appDefaults: { story: { apiConfigId: 'old-api', worldBookIds: ['user-world'] } }, characterBindings: [{ characterId: 'role', defaults: { apiConfigId: 'old-api', worldBookIds: ['yelan:stale:worldbook', 'user-world'], regexIds: ['user-rule'] }, appOverrides: { story: { apiConfigId: 'old-api', presetId: 'user-preset' } } }] },
}));
vi.mock('./yelan-managed-client', () => ({ isYelanManaged: true, yelanRequest: async () => ({ userId: 'user', characters: [{ id: 'role' }] }) }));
vi.mock('./settings-db', () => ({ hydrateSettingsDb: async () => {} }));
vi.mock('./kv-db', () => ({ kvSet: vi.fn() }));
vi.mock('./character-storage', () => ({ saveCharacters: vi.fn() }));
vi.mock('./yelan-role-rules', () => ({ buildManagedRoleSettings: () => ({ preset: { id: 'yelan:role:preset' }, worldBook: { id: 'yelan:role:worldbook' }, regex: { id: 'yelan:role:regex' } }) }));
vi.mock('./phone-inspection-client', () => ({ startPhoneInspection: fixtures.inspection }));
vi.mock('./settings-storage', () => ({
  loadApiConfigs: () => [], saveApiConfigs: vi.fn(), loadBindingConfig: () => structuredClone(fixtures.bindings), saveBindingConfig: fixtures.saveBindings,
  loadPresets: () => [{ id: 'user-preset', name: '用户预设' }, { id: 'yelan:stale:preset' }], savePresets: fixtures.savePresets,
  loadWorldBooks: () => [{ id: 'user-world', entries: [{ content: '用户世界背景' }] }, { id: 'yelan:stale:worldbook' }], saveWorldBooks: fixtures.saveWorldBooks,
  loadRegexes: () => [{ id: 'user-rule', replacement: '用户显示规则' }], saveRegexes: fixtures.saveRegexes,
}));
import { bootstrapYelanLocal } from './yelan-local-bootstrap';
describe('managed boot retains user customization', () => {
  beforeEach(() => vi.clearAllMocks());
  it('refreshes platform APIs and role rules while retaining user material and per-app choices', async () => {
    await bootstrapYelanLocal();
    expect(fixtures.savePresets.mock.calls[0][0]).toEqual([{ id: 'user-preset', name: '用户预设' }, { id: 'yelan:role:preset' }]);
    expect(fixtures.saveWorldBooks.mock.calls[0][0][0].entries[0].content).toBe('用户世界背景');
    expect(fixtures.saveRegexes.mock.calls[0][0][0].replacement).toBe('用户显示规则');
    const bindings = fixtures.saveBindings.mock.calls[0][0];
    expect(bindings.characterBindings[0].defaults.worldBookIds).toEqual(['yelan:role:worldbook', 'user-world']);
    expect(bindings.characterBindings[0].appOverrides.story).toEqual({ apiConfigId: 'yelan:role', presetId: 'user-preset' });
    expect(bindings.appDefaults.story).toEqual({ apiConfigId: 'yelan:role', worldBookIds: ['user-world'] });
  });
  it('still finishes phone boot when operational inspection cannot start', async () => {
    fixtures.inspection.mockImplementationOnce(() => { throw new Error('inspection unavailable'); });
    await expect(bootstrapYelanLocal()).resolves.toBeUndefined();
    expect(fixtures.saveBindings).toHaveBeenCalledTimes(1);
  });
});
