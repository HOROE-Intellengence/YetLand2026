import { describe, expect, it } from 'vitest';
import { normalizeCharacterImportBundle } from './admin';

describe('character import bundle normalization', () => {
  it('normalizes a pasted bundle into an admin character payload', () => {
    const result = normalizeCharacterImportBundle({
      card: {
        name: 'Nova',
        slug: 'nova',
        styleTags: ['soft', 'slow', 'soft', ''],
        boundaryDefault: 2,
        openingFirstVisit: ' hello ',
        openingReturnVisit: ' back ',
        forbiddenPhrases: ['never', 'never', ''],
        description: 'A quiet character.',
        profileSections: [
          { key: 'Voice', value: 'Short sentences.', order: 2 },
          { key: 'World', value: 'Lives near the river.', order: 0 },
          { key: '', value: 'drop me', order: 1 },
        ],
      },
      operatorFields: { rarity: 'paid', priceCandle: '12' },
      tier2: {
        userRole: { name: 'Guide' },
        relationship: 'Old acquaintance.',
        memo: [{ text: 'Met by the river.' }],
      },
    });

    expect(result.errors).toEqual([]);
    expect(result.character).toMatchObject({
      slug: 'nova',
      name: 'Nova',
      rarity: 'paid',
      priceCandle: 12,
      styleTags: ['soft', 'slow'],
      forbiddenPhrases: ['never'],
      openingFirstVisit: 'hello',
      openingReturnVisit: 'back',
    });
    expect(result.character?.profileSections?.map((section) => section.key)).toEqual(['World', 'Voice']);
    expect(result.character?.profileSections?.map((section) => section.order)).toEqual([0, 1]);
    expect(result.tier2).toMatchObject({ detected: true, supported: false, userRoleName: 'Guide', memoCount: 1 });
    expect(result.warnings.map((warning) => warning.code)).toContain('TIER2_UNSUPPORTED');
    expect(result.warnings.map((warning) => warning.code)).toContain('DROPPED_EMPTY_SECTION');
  });

  it('keeps overlong fields as validation errors instead of silently truncating them', () => {
    const result = normalizeCharacterImportBundle({
      card: {
        name: 'Too Long',
        slug: 'too-long',
        boundaryDefault: 2,
        openingFirstVisit: 'x'.repeat(201),
        description: 'valid',
      },
      operatorFields: { rarity: 'free', priceCandle: 0 },
    });

    expect(result.character).toBeNull();
    expect(result.errors.some((error) => error.path === 'openingFirstVisit')).toBe(true);
  });
});
