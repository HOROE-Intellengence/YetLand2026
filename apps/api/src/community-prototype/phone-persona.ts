import type { AdminCharacter } from '../services/characters';

/** Local phone consumes the same compiled user fields as the main character loader. */
export function communityPhonePersona(character: Partial<Pick<AdminCharacter, 'description' | 'profileSections' | 'forbiddenPhrases'>>): string {
  return [
    character.description || '',
    ...(character.profileSections || [])
      .filter(section => section.key !== '备注')
      .sort((a, b) => a.order - b.order)
      .map(section => `${section.key}：${section.value}`),
    character.forbiddenPhrases?.length ? `禁忌表达：${character.forbiddenPhrases.join('；')}` : '',
  ].filter(Boolean).join('\n');
}
