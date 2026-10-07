// 角色卡管理 — BE-101 / 关联 AD-101
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  AdminCharacterImportCommitResponseSchema,
  AdminCharacterImportCommitSchema,
  AdminCharacterImportPreviewRequestSchema,
  AdminCharacterImportPreviewResponseSchema,
  AdminCharacterJsonResponseSchema,
  AdminCharacterReviewSchema,
  AdminCharactersCreateSchema,
  AdminCharactersPatchSchema,
  normalizeCharacterImportBundle,
  type AdminCharacterImportIssue,
  type AdminCharacterImportMode,
  type AdminCharacterImportPreviewResponse,
} from '@yelan/shared';
import { charactersService } from '../../services/characters';
import { getUserById } from '../../services/users';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminCharactersRoute = new Hono();

adminCharactersRoute.get('/', (c) => c.json({ characters: charactersService.listAll() }));

function importIssue(
  severity: 'warning' | 'error',
  code: string,
  path: string,
  message: string,
): AdminCharacterImportIssue {
  return { severity, code, path, message };
}

function parseImportRaw(raw: string): { data: unknown | null; error?: AdminCharacterImportIssue } {
  try {
    return { data: JSON.parse(raw) as unknown };
  } catch (e) {
    return {
      data: null,
      error: importIssue('error', 'INVALID_JSON', 'raw', `JSON 解析失败：${(e as Error).message}`),
    };
  }
}

function buildImportPreview(raw: string, mode: AdminCharacterImportMode): AdminCharacterImportPreviewResponse {
  const parsedRaw = parseImportRaw(raw);
  if (parsedRaw.error) {
    return AdminCharacterImportPreviewResponseSchema.parse({
      mode,
      canImport: false,
      action: 'none',
      existing: null,
      character: null,
      warnings: [],
      errors: [parsedRaw.error],
      tier2: { detected: false, supported: false },
    });
  }

  const normalized = normalizeCharacterImportBundle(parsedRaw.data);
  const errors = [...normalized.errors];
  const warnings = [...normalized.warnings];
  const existing = normalized.character ? charactersService.getAdmin(normalized.character.slug) : null;

  if (normalized.character && mode === 'create' && existing) {
    errors.push(importIssue('error', 'CHARACTER_EXISTS', 'card.slug', `slug 已存在：${existing.slug}`));
  }
  if (normalized.character && mode === 'update' && !existing) {
    errors.push(importIssue('error', 'CHARACTER_NOT_FOUND', 'card.slug', `slug 不存在，不能按更新导入：${normalized.character.slug}`));
  }

  const canImport = Boolean(normalized.character) && errors.length === 0;
  return AdminCharacterImportPreviewResponseSchema.parse({
    mode,
    canImport,
    action: canImport ? (existing ? 'update' : 'create') : 'none',
    existing: existing ? { id: existing.id, slug: existing.slug, name: existing.name } : null,
    character: normalized.character,
    warnings,
    errors,
    tier2: normalized.tier2,
  });
}

adminCharactersRoute.post(
  '/import/preview',
  zValidator('json', AdminCharacterImportPreviewRequestSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    return c.json(buildImportPreview(body.raw, body.mode));
  },
);

adminCharactersRoute.post(
  '/import',
  zValidator('json', AdminCharacterImportCommitSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const preview = buildImportPreview(body.raw, body.mode);
    if (!preview.canImport || !preview.character) return c.json(preview, 400);

    const imported = charactersService.upsert({
      id: preview.existing?.id ?? preview.character.id ?? preview.character.slug,
      slug: preview.character.slug,
      name: preview.character.name,
      rarity: preview.character.rarity,
      priceCandle: preview.character.priceCandle,
      styleTags: preview.character.styleTags,
      preludeCardId: preview.character.preludeCardId ?? null,
      boundaryDefault: preview.character.boundaryDefault,
      openingFirstVisit: preview.character.openingFirstVisit,
      openingReturnVisit: preview.character.openingReturnVisit,
      forbiddenPhrases: preview.character.forbiddenPhrases,
      description: preview.character.description,
      profileSections: preview.character.profileSections,
      isActive: preview.character.isActive,
      hqVoiceProfileId: preview.character.hqVoiceProfileId,
    });
    audit('character.import', imported.id, body.reason, {
      mode: body.mode,
      action: preview.action,
      slug: imported.slug,
      tier2Detected: preview.tier2.detected,
      warnings: preview.warnings,
    });
    const response = AdminCharacterImportCommitResponseSchema.parse({ ...preview, imported });
    return c.json(response, preview.action === 'create' ? 201 : 200);
  },
);

adminCharactersRoute.get('/:id', (c) => {
  const found = charactersService.getAdmin(c.req.param('id'));
  if (!found) return c.json({ code: 'NOT_FOUND', message: 'character not found' }, 404);
  return c.json(found);
});

// 后台档案 JSON 视图 —— 防注入：只回结构化 JSON（角色名/用户名/id + 原始输入 + 编译产物），
// 绝不回拼装后的 prompt 原文。管理员据此核对与审核。
adminCharactersRoute.get('/:id/json', (c) => {
  const found = charactersService.getAdmin(c.req.param('id'));
  if (!found) return c.json({ code: 'NOT_FOUND', message: 'character not found' }, 404);
  const owner = found.ownerUserId ? getUserById(found.ownerUserId) : null;
  const userName = owner
    ? (owner.nickname ?? owner.name ?? owner.email ?? owner.id)
    : found.origin === 'user'
      ? (found.ownerUserId ?? 'unknown')
      : 'admin';
  const response = AdminCharacterJsonResponseSchema.parse({
    id: found.id,
    characterName: found.name,
    userName,
    ownerUserId: found.ownerUserId,
    origin: found.origin,
    visibility: found.visibility,
    reviewStatus: found.reviewStatus,
    isActive: found.isActive,
    updatedAt: found.updatedAt,
    customPayload: found.customPayload ?? null,
    compiled: {
      profileSections: found.profileSections,
      forbiddenPhrases: found.forbiddenPhrases ?? [],
    },
  });
  return c.json(response);
});

// 审核用户自定义卡：通过 → 公开常驻；驳回 → 保持本人私有可见。
adminCharactersRoute.post(
  '/:id/review',
  zValidator('json', AdminCharacterReviewSchema, validationHook),
  (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const reviewed = charactersService.reviewUserCharacter(id, body.action);
    if (!reviewed) {
      return c.json({ code: 'NOT_FOUND', message: 'user character not found' }, 404);
    }
    audit(`character.review.${body.action}`, reviewed.id, body.reason, {
      slug: reviewed.slug,
      reviewStatus: reviewed.reviewStatus,
      visibility: reviewed.visibility,
    });
    return c.json(reviewed);
  },
);

adminCharactersRoute.post(
  '/',
  zValidator('json', AdminCharactersCreateSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const id = body.id ?? body.slug;
    if (charactersService.get(id) || charactersService.get(body.slug)) {
      return c.json({ code: 'EXISTS', message: 'id or slug already exists' }, 409);
    }
    const created = charactersService.upsert({
      id,
      slug: body.slug,
      name: body.name,
      rarity: body.rarity,
      priceCandle: body.priceCandle,
      styleTags: body.styleTags,
      preludeCardId: body.preludeCardId ?? null,
      voiceName: body.voiceName,
      hqVoiceProfileId: body.hqVoiceProfileId,
      boundaryDefault: body.boundaryDefault,
      openingFirstVisit: body.openingFirstVisit,
      openingReturnVisit: body.openingReturnVisit,
      forbiddenPhrases: body.forbiddenPhrases,
      description: body.description,
      profileSections: body.profileSections,
      phoneRules: body.phoneRules,
      isActive: body.isActive,
    });
    audit('character.create', id, body.reason, created);
    return c.json(created, 201);
  },
);

adminCharactersRoute.patch(
  '/:id',
  zValidator('json', AdminCharactersPatchSchema, validationHook),
  async (c) => {
    const id = c.req.param('id');
    const existing = charactersService.getAdmin(id);
    if (!existing) return c.json({ code: 'NOT_FOUND', message: 'character not found' }, 404);
    const body = c.req.valid('json');
    const merged = charactersService.upsert({
      id: existing.id,
      slug: body.slug ?? existing.slug,
      name: body.name ?? existing.name,
      rarity: body.rarity ?? existing.rarity,
      priceCandle: body.priceCandle ?? existing.priceCandle,
      styleTags: body.styleTags ?? existing.styleTags,
      preludeCardId: body.preludeCardId === undefined ? (existing.preludeCardId ?? null) : body.preludeCardId,
      voiceName: body.voiceName ?? existing.voiceName,
      hqVoiceProfileId: body.hqVoiceProfileId ?? existing.hqVoiceProfileId,
      boundaryDefault: body.boundaryDefault ?? existing.boundaryDefault,
      openingFirstVisit: body.openingFirstVisit ?? existing.openingLines.firstVisit,
      openingReturnVisit: body.openingReturnVisit ?? existing.openingLines.returnVisit,
      forbiddenPhrases: body.forbiddenPhrases ?? existing.forbiddenPhrases ?? [],
      description: body.description ?? existing.description,
      profileSections: body.profileSections ?? existing.profileSections,
      phoneRules: body.phoneRules ?? existing.phoneRules,
      isActive: body.isActive ?? existing.isActive,
    });
    audit('character.update', existing.id, body.reason, merged);
    return c.json(merged);
  },
);

adminCharactersRoute.delete('/:id', (c) => {
  const id = c.req.param('id');
  const reason = c.req.query('reason') || 'no reason';
  const ok = charactersService.disable(id);
  if (!ok) return c.json({ code: 'NOT_FOUND', message: 'character not found' }, 404);
  audit('character.disable', id, reason);
  return c.json({ ok: true });
});

adminCharactersRoute.post('/:id/_enable', (c) => {
  const id = c.req.param('id');
  const reason = c.req.query('reason') || 'no reason';
  const ok = charactersService.enable(id);
  if (!ok) return c.json({ code: 'NOT_FOUND', message: 'character not found' }, 404);
  audit('character.enable', id, reason);
  return c.json({ ok: true });
});

adminCharactersRoute.post('/_reset', async (c) => {
  const reason = c.req.query('reason') || 'reset to yaml seed';
  const count = charactersService.resetFromYaml();
  audit('character.reset', undefined, reason, { count });
  return c.json({ ok: true, count });
});
