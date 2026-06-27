import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AdminPreludeCardCreateSchema, AdminPreludeCardPatchSchema } from '@yelan/shared';
import { preludeCardsService } from '../../services/prelude-cards';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminPreludeCardsRoute = new Hono();

adminPreludeCardsRoute.get('/', (c) => {
  return c.json({ preludeCards: preludeCardsService.listAll() });
});

adminPreludeCardsRoute.get('/:id', (c) => {
  const found = preludeCardsService.get(c.req.param('id'));
  if (!found) return c.json({ code: 'NOT_FOUND', message: 'prelude card not found' }, 404);
  return c.json(found);
});

adminPreludeCardsRoute.post(
  '/',
  zValidator('json', AdminPreludeCardCreateSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    if (body.id && preludeCardsService.get(body.id)) {
      return c.json({ code: 'EXISTS', message: 'prelude card already exists' }, 409);
    }
    const created = preludeCardsService.upsert({
      id: body.id,
      name: body.name,
      content: body.content,
      scope: body.scope,
      characterId: body.characterId ?? null,
      priority: body.priority,
      isActive: body.isActive,
    });
    audit('prelude-card.create', created.id, body.reason, created);
    return c.json(created, 201);
  },
);

adminPreludeCardsRoute.patch(
  '/:id',
  zValidator('json', AdminPreludeCardPatchSchema, validationHook),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const updated = preludeCardsService.patch(id, {
      name: body.name,
      content: body.content,
      scope: body.scope,
      characterId: body.characterId,
      priority: body.priority,
      isActive: body.isActive,
    });
    if (!updated) return c.json({ code: 'NOT_FOUND', message: 'prelude card not found' }, 404);
    audit('prelude-card.update', id, body.reason, updated);
    return c.json(updated);
  },
);

adminPreludeCardsRoute.delete('/:id', (c) => {
  const id = c.req.param('id');
  const reason = c.req.query('reason') || 'no reason';
  const ok = preludeCardsService.disable(id);
  if (!ok) return c.json({ code: 'NOT_FOUND', message: 'prelude card not found' }, 404);
  audit('prelude-card.disable', id, reason);
  return c.json({ ok: true });
});

adminPreludeCardsRoute.post('/:id/_enable', (c) => {
  const id = c.req.param('id');
  const reason = c.req.query('reason') || 'no reason';
  const ok = preludeCardsService.enable(id);
  if (!ok) return c.json({ code: 'NOT_FOUND', message: 'prelude card not found' }, 404);
  audit('prelude-card.enable', id, reason);
  return c.json({ ok: true });
});
