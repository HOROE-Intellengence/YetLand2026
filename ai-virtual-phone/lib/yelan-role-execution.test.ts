import { expect, it } from 'vitest';
import { buildManagedRoleSettings } from './yelan-role-rules';
import { assemblePromptPayload, applyOutputRegex } from './llm-prompt-assembler';

it('executes managed presets, triggered worldbook entries and output replacements in the actual assembler', () => {
  const role = { id: 'role-test', name: '角色', persona: '角色设定', avatar: null, canEdit: true, rules: {
    preset: '托管预设标记', worldBook: [{ key: '银色胸针', content: '世界书触发标记', constant: false, useRegex: false, position: 'after_char' as const }],
    regexes: [{ name: '替换', pattern: '原词', replacement: '新词', target: 'output' as const, disabled: false }],
  } };
  const { preset, worldBook, regex } = buildManagedRoleSettings(role);
  const character = { ...role, createdAt: '2026-10-07', updatedAt: '2026-10-07' };
  const base = { character, history: [], preset, worldBooks: [worldBook], regexes: [regex], userName: '测试用户' };
  const active = JSON.stringify(assemblePromptPayload({ ...base, worldBookActivationContext: '那枚银色胸针' }));
  const inactive = JSON.stringify(assemblePromptPayload({ ...base, worldBookActivationContext: '无关文字' }));
  expect(active).toContain('托管预设标记');
  expect(active).toContain('世界书触发标记');
  expect(inactive).not.toContain('世界书触发标记');
  expect(applyOutputRegex('这是原词。', [regex])).toBe('这是新词。');
  regex.rules[0]!.disabled = true;
  expect(applyOutputRegex('这是原词。', [regex])).toBe('这是原词。');
});
