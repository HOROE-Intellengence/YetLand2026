import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { store, type PreludeCardRow } from '../store/persistence';
import { charactersService } from './characters';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_IF_CARD = resolve(here, '..', '..', '..', '..', 'packages', 'prompts', 'prelude-cards', 'if-default.md');

export interface PreludeCardUpsertInput {
  id?: string;
  name: string;
  content: string;
  scope: 'global' | 'character' | 'if';
  characterId?: string | null;
  priority?: number;
  isActive?: boolean;
}

let _hydrated = false;

function now(): string {
  return new Date().toISOString();
}

function hydrateIfNeeded(): void {
  if (_hydrated) return;
  const s = store.state();
  if (Object.keys(s.preludeCards).length === 0 && existsSync(DEFAULT_IF_CARD)) {
    const ts = now();
    s.preludeCards['if-default'] = {
      id: 'if-default',
      name: 'IF 默认前置提示卡',
      content: readFileSync(DEFAULT_IF_CARD, 'utf8').trim(),
      scope: 'if',
      characterId: null,
      priority: 100,
      isActive: true,
      updatedAt: ts,
    };
    store.save();
  }
  _hydrated = true;
}

function sortByPriority(rows: PreludeCardRow[]): PreludeCardRow[] {
  return rows.sort((a, b) => b.priority - a.priority || b.updatedAt.localeCompare(a.updatedAt));
}

export const preludeCardsService = {
  listAll(): PreludeCardRow[] {
    hydrateIfNeeded();
    return sortByPriority(Object.values(store.state().preludeCards));
  },

  get(id: string): PreludeCardRow | null {
    hydrateIfNeeded();
    return store.state().preludeCards[id] ?? null;
  },

  upsert(input: PreludeCardUpsertInput): PreludeCardRow {
    hydrateIfNeeded();
    const id = input.id ?? `prelude-${randomUUID().slice(0, 8)}`;
    const prev = store.state().preludeCards[id];
    const row: PreludeCardRow = {
      id,
      name: input.name,
      content: input.content,
      scope: input.scope,
      characterId: input.characterId ?? null,
      priority: input.priority ?? prev?.priority ?? 0,
      isActive: input.isActive ?? prev?.isActive ?? true,
      updatedAt: now(),
    };
    store.state().preludeCards[id] = row;
    store.save();
    return row;
  },

  patch(id: string, patch: Partial<PreludeCardUpsertInput>): PreludeCardRow | null {
    hydrateIfNeeded();
    const prev = store.state().preludeCards[id];
    if (!prev) return null;
    const row: PreludeCardRow = {
      ...prev,
      ...patch,
      characterId: patch.characterId === undefined ? prev.characterId : patch.characterId,
      priority: patch.priority ?? prev.priority,
      isActive: patch.isActive ?? prev.isActive,
      updatedAt: now(),
    };
    store.state().preludeCards[id] = row;
    store.save();
    return row;
  },

  disable(id: string): boolean {
    return Boolean(this.patch(id, { isActive: false }));
  },

  enable(id: string): boolean {
    return Boolean(this.patch(id, { isActive: true }));
  },

  resolveForChat(characterId: string, ifActive: boolean): PreludeCardRow | null {
    hydrateIfNeeded();
    const rows = this.listAll().filter((row) => row.isActive);

    // 暗号激活时 IF 卡最优先（角色专属 IF 卡 > 全局 IF 卡），压过角色绑定卡。
    if (ifActive) {
      const ifCards = rows.filter((row) => row.scope === 'if' && (!row.characterId || row.characterId === characterId));
      const ifCard = ifCards.find((row) => row.characterId === characterId) ?? ifCards.find((row) => !row.characterId);
      if (ifCard) return ifCard;
    }

    const character = charactersService.get(characterId);
    if (character?.preludeCardId) {
      const bound = this.get(character.preludeCardId);
      // 非激活态下不让绑定的 IF 卡泄露 IF 内容。
      if (bound?.isActive && !(bound.scope === 'if' && !ifActive)) return bound;
    }

    const characterCard = rows.find((row) => row.scope === 'character' && row.characterId === characterId);
    if (characterCard) return characterCard;

    return rows.find((row) => row.scope === 'global') ?? null;
  },
};
