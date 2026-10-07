import { beforeEach, describe, expect, it } from 'vitest';
import { PhoneRoleRulesSchema, AdminCharactersPatchSchema } from '@yelan/shared';
import { store } from '../store/persistence';
import { charactersService } from '../services/characters';
import { phoneRole, savePhoneRoleRules } from './role-rules';
import { loadCharacterCard } from '../prompts/loader';

describe('managed role rules', () => {
  beforeEach(() => {
    store.__resetForTests();
    charactersService.upsert({ id: 'own', slug: 'own', name: '自己的角色', rarity: 'free', priceCandle: 0,
      boundaryDefault: 2, origin: 'user', ownerUserId: 'owner', visibility: 'private', reviewStatus: 'private', description: '原有人设' });
    charactersService.upsert({ id: 'official', slug: 'official', name: '官方角色', rarity: 'free', priceCandle: 0,
      boundaryDefault: 2, origin: 'admin', visibility: 'public' });
  });
  it('allows private owners while denying other users and public-role edits', () => {
    expect(phoneRole('owner', 'own').canEdit).toBe(true);
    expect(() => phoneRole('other', 'own')).toThrow('CHARACTER_NOT_FOUND');
    expect(phoneRole('owner', 'official').canEdit).toBe(false);
    expect(() => savePhoneRoleRules('owner', 'official', {})).toThrow('PHONE_ROLE_READ_ONLY');
  });
  it('persists rules without changing legacy role prompts or unrelated fields', () => {
    const before = loadCharacterCard('own');
    const saved = savePhoneRoleRules('owner', 'own', { preset: '小手机补充预设',
      worldBook: [{ key: '咖啡', content: '无糖' }], regexes: [{ pattern: '小朋友', replacement: '朋友' }] });
    expect(saved.rules.worldBook[0]?.position).toBe('after_char');
    expect(phoneRole('owner', 'own').rules.preset).toBe('小手机补充预设');
    expect(loadCharacterCard('own')).toBe(before);
    expect(charactersService.getRow('own')?.ownerUserId).toBe('owner');
  });
  it('validates all write paths and preserves rules through unrelated admin edits', () => {
    expect(PhoneRoleRulesSchema.safeParse({ regexes: [{ pattern: '[', replacement: '' }] }).success).toBe(false);
    expect(AdminCharactersPatchSchema.safeParse({ reason: 'test', phoneRules: { worldBook: [{ key: '', content: '无触发词' }] } }).success).toBe(false);
    savePhoneRoleRules('owner', 'own', { preset: '仅小手机生效' });
    const row = charactersService.getRow('own')!;
    charactersService.upsert({ ...row, description: '更新原有人设' });
    expect(phoneRole('owner', 'own').rules.preset).toBe('仅小手机生效');
  });
});
