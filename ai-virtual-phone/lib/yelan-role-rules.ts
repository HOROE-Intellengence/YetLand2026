import type { PhoneRoleRules } from '../../packages/shared/src/contracts/phone';
import { createBuiltinPreset } from './builtin-preset';
import type { PresetConfig, RegexConfig, WorldBookConfig } from './settings-types';

export type ManagedRole = { id: string; name: string; persona: string; avatar: null; updatedAt?: string; canEdit: boolean; rules: PhoneRoleRules };

export function buildManagedRoleSettings(role: ManagedRole) {
  const now = Date.now();
  const base = `yelan:${role.id}`;
  const preset: PresetConfig = { ...createBuiltinPreset(), id: `${base}:preset`, builtIn: false, name: `${role.name} · 托管预设` };
  if (role.rules.preset.trim()) {
    preset.prompts.push({ identifier: 'yelan_role_rules', name: '角色补充预设', role: 'system', content: role.rules.preset, enabled: true, injection_depth: 0 });
    preset.prompt_order!.splice(4, 0, { identifier: 'yelan_role_rules', enabled: true });
  }
  const worldBook: WorldBookConfig = { id: `${base}:worldbook`, name: `${role.name} · 世界书`, createdAt: now, updatedAt: now,
    entries: role.rules.worldBook.map((entry, i) => ({ uid: `${base}:wb:${i}`, key: entry.key, content: entry.content,
      comment: '', constant: entry.constant, use_regex: entry.useRegex, disable: false, position: entry.position, insertion_order: i })) };
  const regex: RegexConfig = { id: `${base}:regex`, name: `${role.name} · 正则`, createdAt: now, updatedAt: now,
    rules: role.rules.regexes.map((entry, i) => ({ id: `${base}:re:${i}`, scriptName: entry.name,
      findRegex: entry.pattern, replaceString: entry.replacement, disabled: entry.disabled,
      placement: [entry.target === 'input' ? 1 : 2], tags: [] })) };
  return { preset, worldBook, regex };
}
