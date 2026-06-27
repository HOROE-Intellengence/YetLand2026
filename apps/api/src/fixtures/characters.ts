import type { Character } from '@yelan/shared';

export const mockCharacters: Character[] = [
  {
    id: 'shen-yan-zhi', slug: 'shen-yan-zhi', name: '沈砚之',
    rarity: 'free', priceCandle: 0, styleTags: ['modern', 'restrained', 'push-pull'],
    promptCardKey: 'characters/shen-yan-zhi.yaml',
    boundaryDefault: 2, isActive: true,
    openingLines: { firstVisit: '今夜，你来得比我想得早。', returnVisit: '我还以为，你今晚不会来了。' },
  },
  {
    id: 'jiang-bai', slug: 'jiang-bai', name: '江白',
    rarity: 'paid', priceCandle: 120, styleTags: ['cool', 'tease'],
    promptCardKey: 'characters/jiang-bai.yaml',
    boundaryDefault: 2, isActive: true,
    openingLines: { firstVisit: '不急，先把外套挂好。', returnVisit: '今晚的茶有点凉。' },
  },
];

export const mockUserCharacters = [
  { characterId: 'shen-yan-zhi', unlockedAt: '2026-05-01T00:00:00Z' },
];
