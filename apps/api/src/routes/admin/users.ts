import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AdminUsersFlagsSchema } from '@yelan/shared';
import { listUsers, getUserById, patchUserFlags } from '../../services/users';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminUsersRoute = new Hono();

adminUsersRoute.get('/', (c) => {
  const limit = Number(c.req.query('limit') ?? 100);
  return c.json(listUsers().slice(0, limit));
});

adminUsersRoute.get('/:id', (c) => {
  const id = c.req.param('id');
  const u = getUserById(id);
  if (!u) return c.json({ code: 'NOT_FOUND', message: 'user not found' }, 404);
  return c.json(u);
});

adminUsersRoute.patch(
  '/:id/flags',
  zValidator('json', AdminUsersFlagsSchema, validationHook),
  async (c) => {
    const id = c.req.param('id');
    const body = c.req.valid('json');
    const { reason, ...patch } = body;
    const u = patchUserFlags(id, patch);
    if (!u) return c.json({ code: 'NOT_FOUND', message: 'user not found' }, 404);
    audit('user.flags', id, reason, patch);
    return c.json({ ok: true, user: u });
  },
);
