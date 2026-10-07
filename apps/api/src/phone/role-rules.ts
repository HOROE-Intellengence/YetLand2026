import { PhoneRoleRulesSchema } from '@yelan/shared';
import { charactersService } from '../services/characters';
import { accessibleCharacter, PhoneError } from './memory';
import { store } from '../store/persistence';

export function phoneRole(userId: string, id: string) {
  const characterId = accessibleCharacter(userId, id);
  const row = charactersService.getRow(characterId)!;
  return {
    characterId, rules: PhoneRoleRulesSchema.parse(row.phoneRules ?? {}),
    canEdit: row.origin === 'user' && row.ownerUserId === userId && row.visibility === 'private',
  };
}

export function savePhoneRoleRules(userId: string, id: string, data: unknown) {
  const role = phoneRole(userId, id);
  if (!role.canEdit) throw new PhoneError('PHONE_ROLE_READ_ONLY', 403);
  const parsed = PhoneRoleRulesSchema.safeParse(data);
  if (!parsed.success) throw new PhoneError('INVALID_PHONE_RULES');
  const row = charactersService.getRow(role.characterId)!;
  row.phoneRules = parsed.data;
  row.updatedAt = new Date().toISOString();
  store.save();
  return { ...role, rules: parsed.data };
}
