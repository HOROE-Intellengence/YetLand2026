import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { adminCharactersRoute } from '../routes/admin/characters';
import { mockCharactersRoute } from '../routes/characters';
import { loadCharacterCard } from '../prompts/loader';

describe('character profile sections', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('admin create persists private profile sections and prompt renders them', async () => {
    const res = await adminCharactersRoute.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slug: 'test-profile',
        name: '测试角色',
        rarity: 'free',
        priceCandle: 0,
        boundaryDefault: 2,
        description: '基础描述',
        profileSections: [
          { key: '口癖', value: '说话前会短暂停顿。', order: 1 },
          { key: '故事', value: '曾经离开过这座城市。', order: 0 },
        ],
        reason: 'test profile sections',
      }),
    });

    expect(res.status).toBe(201);
    const created = await res.json() as { profileSections?: Array<{ key: string; value: string; order: number }> };
    expect(created.profileSections?.map((section) => section.key)).toEqual(['故事', '口癖']);

    const prompt = loadCharacterCard('test-profile');
    expect(prompt).toContain('设定细节');
    expect(prompt).toContain('- 故事：曾经离开过这座城市。');
    expect(prompt).toContain('- 口癖：说话前会短暂停顿。');
  });

  it('admin list defaults old rows to an empty profileSections array', async () => {
    store.state().characters['old-char'] = {
      id: 'old-char',
      slug: 'old-char',
      name: '旧角色',
      rarity: 'free',
      priceCandle: 0,
      styleTags: [],
      boundaryDefault: 2,
      isActive: true,
      openingFirstVisit: '',
      openingReturnVisit: '',
      forbiddenPhrases: [],
      description: '',
      updatedAt: new Date().toISOString(),
    };
    store.save();

    const res = await adminCharactersRoute.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as { characters: Array<{ id: string; profileSections?: unknown[] }> };
    expect(body.characters.find((character) => character.id === 'old-char')?.profileSections).toEqual([]);
  });

  it('public character responses do not expose private profile sections', async () => {
    store.state().characters['public-char'] = {
      id: 'public-char',
      slug: 'public-char',
      name: '公开角色',
      rarity: 'free',
      priceCandle: 0,
      styleTags: [],
      boundaryDefault: 2,
      isActive: true,
      openingFirstVisit: '',
      openingReturnVisit: '',
      forbiddenPhrases: [],
      description: '公开简介',
      profileSections: [{ key: '秘密', value: '不能给前端。', order: 0 }],
      updatedAt: new Date().toISOString(),
    };
    store.save();

    const detail = await mockCharactersRoute.request('/public-char');
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as Record<string, unknown>;
    expect(detailBody.profileSections).toBeUndefined();

    const list = await mockCharactersRoute.request('/');
    expect(list.status).toBe(200);
    const listBody = await list.json() as Array<Record<string, unknown>>;
    expect(listBody[0]?.profileSections).toBeUndefined();
  });
});
