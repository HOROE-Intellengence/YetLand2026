import { api } from './client';
import type { Character } from '@yelan/shared';

export const listCharacters = () => api<Character[]>('/api/characters');
export const getCharacter = (id: string) => api<Character>(`/api/characters/${id}`);
export const unlockCharacter = (id: string) =>
  api<{ ok: true }>(`/api/characters/${id}/unlock`, { method: 'POST' });
export const myCharacters = () => api<{ characterId: string; unlockedAt: string }[]>('/api/me/characters');
