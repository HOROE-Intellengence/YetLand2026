import { beforeEach, describe, expect, it } from 'vitest';
import { adminCharactersRoute } from '../routes/admin/characters';
import { store } from '../store/persistence';

const importBundle = {
  card: {
    name: 'Nova',
    slug: 'nova',
    styleTags: ['soft', 'slow'],
    boundaryDefault: 2,
    openingFirstVisit: 'Hello.',
    openingReturnVisit: 'Back again?',
    forbiddenPhrases: ['I will conquer the world'],
    description: 'A quiet character with a slow rhythm.',
    profileSections: [
      { key: 'World', value: 'Lives near the river.', order: 0 },
      { key: 'Voice', value: 'Short sentences.', order: 1 },
    ],
  },
  operatorFields: { rarity: 'free', priceCandle: 0 },
  tier2: {
    userRole: { name: 'Guide' },
    relationship: 'Old acquaintance.',
    memo: [{ text: 'Met by the river.' }],
  },
};

describe('admin character import', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('previews a pasted bundle without writing the character', async () => {
    const res = await adminCharactersRoute.request('/import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: JSON.stringify(importBundle), mode: 'upsert' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      canImport: boolean;
      action: string;
      character?: { slug: string; profileSections: unknown[] };
      warnings: Array<{ code: string }>;
      tier2: { detected: boolean; supported: boolean };
    };
    expect(body.canImport).toBe(true);
    expect(body.action).toBe('create');
    expect(body.character?.slug).toBe('nova');
    expect(body.character?.profileSections).toHaveLength(2);
    expect(body.tier2).toMatchObject({ detected: true, supported: false });
    expect(body.warnings.map((warning) => warning.code)).toContain('TIER2_UNSUPPORTED');
    expect(store.state().characters.nova).toBeUndefined();
  });

  it('reports invalid pasted JSON before normalization', async () => {
    const res = await adminCharactersRoute.request('/import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: '{"card":', mode: 'upsert' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { canImport: boolean; errors: Array<{ code: string }> };
    expect(body.canImport).toBe(false);
    expect(body.errors.map((error) => error.code)).toContain('INVALID_JSON');
    expect(Object.keys(store.state().characters)).toHaveLength(0);
  });

  it('imports the normalized character and records an audit entry', async () => {
    const res = await adminCharactersRoute.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: JSON.stringify(importBundle), mode: 'upsert', reason: 'test import' }),
    });

    expect(res.status).toBe(201);
    const body = await res.json() as { imported: { id: string; slug: string; profileSections: unknown[] } };
    expect(body.imported.slug).toBe('nova');
    expect(body.imported.profileSections).toHaveLength(2);
    expect(store.state().characters.nova).toMatchObject({
      slug: 'nova',
      name: 'Nova',
      description: 'A quiet character with a slow rhythm.',
    });
    expect(store.state().adminAudit.at(-1)).toMatchObject({
      action: 'character.import',
      target: 'nova',
      reason: 'test import',
      payload: { mode: 'upsert', action: 'create', slug: 'nova', tier2Detected: true },
    });
  });

  it('blocks create-only imports when the slug already exists', async () => {
    await adminCharactersRoute.request('/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: JSON.stringify(importBundle), mode: 'upsert', reason: 'first import' }),
    });

    const res = await adminCharactersRoute.request('/import/preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: JSON.stringify(importBundle), mode: 'create' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { canImport: boolean; action: string; errors: Array<{ code: string }> };
    expect(body.canImport).toBe(false);
    expect(body.action).toBe('none');
    expect(body.errors.map((error) => error.code)).toContain('CHARACTER_EXISTS');
  });
});
