import { Hono } from 'hono';
import { CharacterUnlockResponseSchema } from '@yelan/shared';
import { mockUserCharacters } from '../fixtures/characters';
import { softAuth } from '../middleware/auth';
import { adjustCandle, getUserById } from '../services/users';
import { charactersService } from '../services/characters';
import { constellationsService } from '../services/constellations';
import { policyService } from '../services/policy';

export const mockCharactersRoute = new Hono();

// 星座独立存储，读时 join 进角色卡（持久化优先，缺省回退内置默认）
mockCharactersRoute.get('/', (c) =>
  c.json(
    charactersService
      .listActive()
      .map((ch) => ({ ...ch, constellation: constellationsService.resolve(ch.slug) })),
  ),
);

mockCharactersRoute.get('/:id', (c) => {
  const id = c.req.param('id');
  const found = charactersService.get(id);
  if (!found) return c.json({ code: 'NOT_FOUND', message: 'character not found' }, 404);
  return c.json({ ...found, constellation: constellationsService.resolve(found.slug) });
});

mockCharactersRoute.use('/:id/unlock', softAuth());
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
