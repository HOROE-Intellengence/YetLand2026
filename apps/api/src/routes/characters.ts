import { Hono } from 'hono';
import { CharacterUnlockResponseSchema } from '@yelan/shared';
import { mockUserCharacters } from '../fixtures/characters';
import { softAuth } from '../middleware/auth';
import { adjustCandle, getUserById } from '../services/users';
import { charactersService } from '../services/characters';
import { constellationsService } from '../services/constellations';
import { policyService } from '../services/policy';

export const mockCharactersRoute = new Hono();

// 全局软鉴权：拿到 userId 以便按可见性过滤（含"本人的私有卡"）。
mockCharactersRoute.use('*', softAuth());

// 星座独立存储，读时 join 进角色卡（持久化优先，缺省回退内置默认）
// 列表 = 对当前访问者可见的卡（公开可见 + 本人私有卡）。
mockCharactersRoute.get('/', (c) => {
  const userId = c.get('userId') as string | undefined;
  return c.json(
    charactersService
      .listVisibleTo(userId)
      .map((ch) => ({ ...ch, constellation: constellationsService.resolve(ch.slug) })),
  );
});

mockCharactersRoute.get('/:id', (c) => {
  const id = c.req.param('id');
  const userId = c.get('userId') as string | undefined;
  const found = charactersService.get(id);
  // 越权护栏：私有卡仅本人可读；他人一律 404（不暴露存在性）。
  if (!found || !charactersService.canAccess(id, userId)) {
    return c.json({ code: 'NOT_FOUND', message: 'character not found' }, 404);
  }
  return c.json({ ...found, constellation: constellationsService.resolve(found.slug) });
});
mockCharactersRoute.post('/:id/unlock', (c) => {
  const enabled = policyService.get<boolean>('EXCHANGE_ENABLED', true);
  if (!enabled) return c.json({ code: 'EXCHANGE_DISABLED', message: '兑换功能已关闭' }, 403);
  const id = c.req.param('id');
  const userId = c.get('userId') as string;
  const u = getUserById(userId);
  if (!u) return c.json(CharacterUnlockResponseSchema.parse({ code: 'NOT_FOUND', message: 'user not found' }), 404);
  const card = charactersService.get(id);
  if (!card) return c.json(CharacterUnlockResponseSchema.parse({ code: 'NOT_FOUND', message: 'character not found' }), 404);
  if (card.priceCandle === 0) return c.json(CharacterUnlockResponseSchema.parse({ ok: true, alreadyFree: true }));
  if (u.candle < card.priceCandle) {
    return c.json(CharacterUnlockResponseSchema.parse({ code: 'INSUFFICIENT_CANDLE', message: 'not enough candle' }), 402);
  }
  adjustCandle(userId, -card.priceCandle, 'unlock_card', card.id);
  return c.json(CharacterUnlockResponseSchema.parse({ ok: true }));
});

mockCharactersRoute.get('/me/list', (c) => c.json(mockUserCharacters));
