// 用户自定义角色卡 —— 前端 API（feat/user-character-cards P3）
import { api } from './client';
import type { Character, UserCharacterCreate } from '@yelan/shared';

export interface CreatedCharacterResponse {
  character: Character;
  profile: {
    id: string;
    characterName: string;
    userName: string;
    ownerUserId: string;
  };
}

/** 提交自定义角色卡（需登录）→ 后端编译落库为私有/待审。 */
export const createMyCharacter = (payload: UserCharacterCreate) =>
  api<CreatedCharacterResponse>('/api/me/created-characters', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

/** 列出本人创建的角色卡。 */
export const listMyCreatedCharacters = () =>
  api<{ characters: Character[] }>('/api/me/created-characters');
