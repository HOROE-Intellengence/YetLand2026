// 角色卡 service — BE-101 角色卡 DB 化
// 真理源：state.json 的 characters 字段；首次启动若空则从 packages/prompts/characters/*.yaml seed
// 改字段无需重启：list/get 直接读 state；upsert 落 store.save()
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Character, CharacterProfileSection } from '@yelan/shared';
import { store, type CharacterRow } from '../store/persistence';
import { parseTinyYaml } from '../prompts/yaml';

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src/services → ../../../../packages/prompts/characters
const YAML_DIR = resolve(here, '..', '..', '..', '..', 'packages', 'prompts', 'characters');

function readYamlSeed(): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  if (!existsSync(YAML_DIR)) return out;
  for (const f of readdirSync(YAML_DIR)) {
    if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
    const slug = f.replace(/\.(yaml|yml)$/, '');
    out[slug] = parseTinyYaml(readFileSync(join(YAML_DIR, f), 'utf8'));
  }
  return out;
}

function asBoundary(n: unknown): 1 | 2 | 3 | 4 | 5 {
  const v = typeof n === 'number' ? n : 2;
  if (v === 1 || v === 2 || v === 3 || v === 4 || v === 5) return v;
  return 2;
}

function asRarity(s: unknown): 'free' | 'paid' | 'hidden' {
  return s === 'paid' || s === 'hidden' ? s : 'free';
}

function normalizeProfileSections(value: unknown): CharacterProfileSection[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const row = item as Partial<CharacterProfileSection>;
      const key = typeof row.key === 'string' ? row.key.trim() : '';
      const sectionValue = typeof row.value === 'string' ? row.value.trim() : '';
      const order = Number.isInteger(row.order) ? Number(row.order) : index;
      if (!key || !sectionValue) return null;
      return { key, value: sectionValue, order };
    })
    .filter((item): item is CharacterProfileSection => Boolean(item))
    .sort((a, b) => a.order - b.order)
    .map((item, index) => ({ ...item, order: index }));
}

function rowFromYaml(slug: string, raw: Record<string, unknown>): CharacterRow {
  const opening = (raw.opening_lines as Record<string, unknown> | undefined) ?? {};
  const voice = (raw.voice as Record<string, unknown> | undefined) ?? {};
  const styleTags = Array.isArray(raw.style_tags) ? (raw.style_tags as string[]) : [];
  const forbidden = Array.isArray(voice.forbidden_phrases) ? (voice.forbidden_phrases as string[]) : [];
  return {
    id: typeof raw.id === 'string' ? raw.id : slug,
    slug,
    name: typeof raw.name === 'string' ? raw.name : slug,
    rarity: asRarity(raw.rarity),
    priceCandle: typeof raw.price_candle === 'number' ? raw.price_candle : 0,
    styleTags,
    promptCardKey: typeof raw.prompt_card_key === 'string' ? raw.prompt_card_key : `characters/${slug}.yaml`,
    preludeCardId: null,
    boundaryDefault: asBoundary(raw.boundary_default),
    isActive: true,
    openingFirstVisit: typeof opening.first_visit === 'string' ? opening.first_visit : '',
    openingReturnVisit: typeof opening.return_visit === 'string' ? opening.return_visit : '',
    forbiddenPhrases: forbidden,
    description: typeof raw.description === 'string' ? raw.description : '',
    profileSections: [],
    updatedAt: new Date().toISOString(),
  };
}

let _hydrated = false;

/** 首次访问时若 state.characters 为空，则从 yaml 兜底 seed 进 state */
function hydrateIfNeeded(): void {
  if (_hydrated) return;
  const s = store.state();
  const empty = Object.keys(s.characters).length === 0;
  if (empty) {
    const raws = readYamlSeed();
    for (const [slug, raw] of Object.entries(raws)) {
      const row = rowFromYaml(slug, raw);
      s.characters[row.id] = row;
    }
    if (Object.keys(s.characters).length > 0) store.save();
  }
  _hydrated = true;
}

function rowToCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    rarity: row.rarity,
    priceCandle: row.priceCandle,
    styleTags: row.styleTags,
    promptCardKey: row.promptCardKey,
    preludeCardId: row.preludeCardId ?? null,
    boundaryDefault: row.boundaryDefault,
    isActive: row.isActive,
    openingLines: {
      firstVisit: row.openingFirstVisit,
      returnVisit: row.openingReturnVisit,
    },
    description: row.description,
    forbiddenPhrases: row.forbiddenPhrases,
    updatedAt: row.updatedAt,
  };
}

export type AdminCharacter = Character & {
  profileSections: CharacterProfileSection[];
};

function rowToAdminCharacter(row: CharacterRow): AdminCharacter {
  return {
    ...rowToCharacter(row),
    profileSections: normalizeProfileSections(row.profileSections),
  };
}

export interface CharacterUpsertInput {
  id?: string;
  slug: string;
  name: string;
  rarity: 'free' | 'paid' | 'hidden';
  priceCandle: number;
  styleTags?: string[];
  preludeCardId?: string | null;
  boundaryDefault: 1 | 2 | 3 | 4 | 5;
  openingFirstVisit?: string;
  openingReturnVisit?: string;
  forbiddenPhrases?: string[];
  description?: string;
  profileSections?: CharacterProfileSection[];
  isActive?: boolean;
}

export const charactersService = {
  /** 列出全部（含已停用）；运营面板用 */
  listAll(): AdminCharacter[] {
    hydrateIfNeeded();
    return Object.values(store.state().characters).map(rowToAdminCharacter);
  },

  /** 列出在用（公开 API 用） */
  listActive(): Character[] {
    hydrateIfNeeded();
    return Object.values(store.state().characters)
      .filter((c) => c.isActive)
      .map(rowToCharacter);
  },

  /** 按 id 或 slug 查 */
  get(idOrSlug: string): Character | null {
    hydrateIfNeeded();
    const all = store.state().characters;
    const direct = all[idOrSlug];
    if (direct) return rowToCharacter(direct);
    const bySlug = Object.values(all).find((r) => r.slug === idOrSlug);
    return bySlug ? rowToCharacter(bySlug) : null;
  },

  /** 后台查询：包含私有人设字段 */
  getAdmin(idOrSlug: string): AdminCharacter | null {
    hydrateIfNeeded();
    const all = store.state().characters;
    const direct = all[idOrSlug];
    if (direct) return rowToAdminCharacter(direct);
    const bySlug = Object.values(all).find((r) => r.slug === idOrSlug);
    return bySlug ? rowToAdminCharacter(bySlug) : null;
  },

  /** 给 prompts/loader 装 system prompt 用 — 直接拿运行期最新值 */
  getRow(idOrSlug: string): CharacterRow | null {
    hydrateIfNeeded();
    const all = store.state().characters;
    return all[idOrSlug] ?? Object.values(all).find((r) => r.slug === idOrSlug) ?? null;
  },

  /** 创建或全量替换 */
  upsert(input: CharacterUpsertInput): AdminCharacter {
    hydrateIfNeeded();
    const id = input.id ?? input.slug;
    const s = store.state();
    const prev = s.characters[id];
    const row: CharacterRow = {
      id,
      slug: input.slug,
      name: input.name,
      rarity: input.rarity,
      priceCandle: input.priceCandle,
      styleTags: input.styleTags ?? prev?.styleTags ?? [],
      promptCardKey: prev?.promptCardKey ?? `characters/${input.slug}.yaml`,
      preludeCardId: input.preludeCardId === undefined ? (prev?.preludeCardId ?? null) : input.preludeCardId,
      boundaryDefault: input.boundaryDefault,
      isActive: input.isActive ?? prev?.isActive ?? true,
      openingFirstVisit: input.openingFirstVisit ?? prev?.openingFirstVisit ?? '',
      openingReturnVisit: input.openingReturnVisit ?? prev?.openingReturnVisit ?? '',
      forbiddenPhrases: input.forbiddenPhrases ?? prev?.forbiddenPhrases ?? [],
      description: input.description ?? prev?.description ?? '',
      profileSections: normalizeProfileSections(input.profileSections ?? prev?.profileSections),
      updatedAt: new Date().toISOString(),
    };
    s.characters[id] = row;
    store.save();
    return rowToAdminCharacter(row);
  },

  /** 软删（停用）— 不真删，便于回滚和审计 */
  disable(id: string): boolean {
    hydrateIfNeeded();
    const s = store.state();
    const row = s.characters[id] ?? Object.values(s.characters).find((r) => r.slug === id);
    if (!row) return false;
    row.isActive = false;
    row.updatedAt = new Date().toISOString();
    store.save();
    return true;
  },

  /** 重新启用 */
  enable(id: string): boolean {
    hydrateIfNeeded();
    const s = store.state();
    const row = s.characters[id] ?? Object.values(s.characters).find((r) => r.slug === id);
    if (!row) return false;
    row.isActive = true;
    row.updatedAt = new Date().toISOString();
    store.save();
    return true;
  },

  /** 重置为 yaml seed — 测试 / 紧急回滚用 */
  resetFromYaml(): number {
    const s = store.state();
    s.characters = {};
    _hydrated = false;
    hydrateIfNeeded();
    return Object.keys(s.characters).length;
  },
};
