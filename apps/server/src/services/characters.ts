import type { Env } from '../types/bindings';
import { characters as defaultCharacters, type CharacterCard } from '@yelan/prompts';

export interface CharacterRecord {
  id: string;
  name: string;
  rarity: 'free' | 'paid' | 'hidden';
  priceCandle: number;
  description: string;
  styleTags: string[];
  boundaryDefault: 1 | 2 | 3 | 4 | 5;
  isActive: boolean;
}

function fromCardData(id: string, data: CharacterCard): CharacterRecord {
  return {
    id: data.id ?? id,
    name: data.name ?? id,
    rarity: data.rarity,
    priceCandle: data.price_candle ?? 0,
    description: data.description ?? '',
    styleTags: data.style_tags ?? [],
    boundaryDefault: data.boundary_default ?? 2,
    isActive: true,
  };
}

export async function listVisibleCharacters(_env: Env, _userId: string): Promise<CharacterRecord[]> {
  return Object.entries(defaultCharacters).map(([id, data]) => fromCardData(id, data));
}

export async function getCharacter(_env: Env, characterId: string): Promise<CharacterRecord | null> {
  const data = defaultCharacters[characterId];
  if (!data) return null;
  return fromCardData(characterId, data);
}

export async function unlockCharacter(
  _env: Env,
  _userId: string,
  _characterId: string,
  _source: 'candle' | 'achievement' | 'admin' | 'if_unlock',
): Promise<void> {
  // TODO: 事务 — 读 character.price_candle → 扣余额 → 写 ledger → 写 user_character_unlocks
}
