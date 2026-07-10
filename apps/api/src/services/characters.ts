// 角色卡 service — BE-101 角色卡 DB 化
// 真理源：state.json 的 characters 字段；首次启动若空则从 packages/prompts/characters/*.yaml seed
// 改字段无需重启：list/get 直接读 state；upsert 落 store.save()
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { Character, CharacterProfileSection, UserCharacterCreate } from '@yelan/shared';
import { compileUserCharacter } from '@yelan/shared';
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
    origin: 'admin',
    reviewStatus: 'none',
    visibility: 'public',
    updatedAt: new Date().toISOString(),
  };
}

/** origin 缺省视为 admin —— 老数据/yaml seed 没有该字段。 */
function rowOrigin(row: CharacterRow): 'admin' | 'user' {
  return row.origin === 'user' ? 'user' : 'admin';
}

/** 是否对所有人公开可见：admin 卡=在用即可；用户卡=公开意愿 + 审核通过 + 在用。 */
export function isPubliclyVisible(row: CharacterRow): boolean {
  if (!row.isActive) return false;
  if (rowOrigin(row) === 'admin') return true;
  return row.visibility === 'public' && row.reviewStatus === 'approved';
}

/** 某用户能否访问该卡（读取/进入对话）：公开可见 或 本人的卡。 */
function canAccessRow(row: CharacterRow, userId: string | undefined): boolean {
  if (isPubliclyVisible(row)) return true;
  return Boolean(userId) && row.ownerUserId === userId;
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
  origin: 'admin' | 'user';
  ownerUserId: string | null;
  visibility: 'private' | 'public';
  reviewStatus: 'none' | 'private' | 'pending' | 'approved' | 'rejected';
  customPayload?: unknown;
};

function rowToAdminCharacter(row: CharacterRow): AdminCharacter {
  return {
    ...rowToCharacter(row),
    profileSections: normalizeProfileSections(row.profileSections),
    origin: rowOrigin(row),
    ownerUserId: row.ownerUserId ?? null,
    visibility: row.visibility ?? 'public',
    reviewStatus: row.reviewStatus ?? 'none',
    customPayload: row.customPayload,
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
  origin?: 'admin' | 'user';
  ownerUserId?: string | null;
  visibility?: 'private' | 'public';
  reviewStatus?: 'none' | 'private' | 'pending' | 'approved' | 'rejected';
  customPayload?: unknown;
}

export const charactersService = {
  /** 列出全部（含已停用）；运营面板用 */
  listAll(): AdminCharacter[] {
    hydrateIfNeeded();
    return Object.values(store.state().characters).map(rowToAdminCharacter);
  },

  /** 列出对所有人公开可见的卡（不含用户私有卡）。匿名/未登录公开 API 用。 */
  listActive(): Character[] {
    hydrateIfNeeded();
    return Object.values(store.state().characters)
      .filter((c) => isPubliclyVisible(c))
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
      origin: input.origin ?? prev?.origin ?? 'admin',
      ownerUserId: input.ownerUserId === undefined ? (prev?.ownerUserId ?? null) : input.ownerUserId,
      visibility: input.visibility ?? prev?.visibility ?? 'public',
      reviewStatus: input.reviewStatus ?? prev?.reviewStatus ?? 'none',
      customPayload: input.customPayload === undefined ? prev?.customPayload : input.customPayload,
      updatedAt: new Date().toISOString(),
    };
    s.characters[id] = row;
    store.save();
    return rowToAdminCharacter(row);
  },

  /** 用户创建自定义卡 —— 编译进既有 profileSections/forbiddenPhrases，落库为私有或待审。 */
  createFromUser(ownerUserId: string, payload: UserCharacterCreate): AdminCharacter {
    hydrateIfNeeded();
    const { profileSections, forbiddenPhrases } = compileUserCharacter(payload);
    const id = `custom-${randomUUID()}`;
    return this.upsert({
      id,
      slug: id,
      name: payload.name,
      rarity: 'free',
      priceCandle: 0,
      styleTags: [],
      boundaryDefault: 2,
      isActive: true,
      forbiddenPhrases,
      profileSections,
      description: '',
      origin: 'user',
      ownerUserId,
      visibility: payload.makePublic ? 'public' : 'private',
      // 申请公开 → 待审；仅自用 → private（本人可见可进，不进公共列表）
      reviewStatus: payload.makePublic ? 'pending' : 'private',
      customPayload: payload,
    });
  },

  /** 列出对某访问者可见的卡：公开可见 + 本人的私有卡。公开列表 API 用。 */
  listVisibleTo(userId: string | undefined): Character[] {
    hydrateIfNeeded();
    return Object.values(store.state().characters)
      .filter((c) => canAccessRow(c, userId))
      .map(rowToCharacter);
  },

  /** 列出某用户创建的卡（含私有/待审/已拒），本人后台/我的列表用。 */
  listCreatedBy(userId: string): AdminCharacter[] {
    hydrateIfNeeded();
    return Object.values(store.state().characters)
      .filter((c) => rowOrigin(c) === 'user' && c.ownerUserId === userId)
      .map(rowToAdminCharacter);
  },

  /** 访问控制：某用户能否读取/进入该卡（越权护栏）。 */
  canAccess(idOrSlug: string, userId: string | undefined): boolean {
    const row = this.getRow(idOrSlug);
    return Boolean(row) && canAccessRow(row!, userId);
  },

  /**
   * 审核用户自定义卡：approve → 公开常驻（visibility=public + reviewStatus=approved）；
   * reject → reviewStatus=rejected（仍归本人私有可见，不进公共列表）。
   * 仅对 origin='user' 的卡有效；非用户卡返回 null。
   */
  reviewUserCharacter(id: string, action: 'approve' | 'reject'): AdminCharacter | null {
    hydrateIfNeeded();
    const s = store.state();
    const row = s.characters[id] ?? Object.values(s.characters).find((r) => r.slug === id);
    if (!row || rowOrigin(row) !== 'user') return null;
    if (action === 'approve') {
      row.visibility = 'public';
      row.reviewStatus = 'approved';
    } else {
      row.reviewStatus = 'rejected';
    }
    row.updatedAt = new Date().toISOString();
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
