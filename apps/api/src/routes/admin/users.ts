import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AdminUsersFlagsSchema } from '@yelan/shared';
import { listUsers, getUserById, patchUserFlags } from '../../services/users';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminUsersRoute = new Hono();

adminUsersRoute.get('/', (c) => {
  // 缺省不截断（0/未传 → 全量）。历史上默认 100 + 前端 limit=200 会把「最新」用户切掉：
  // listUsers() 是插入序（旧→新），slice(0,200) 恰好丢弃最新注册的用户 → 后台看不到新增。
  const rawLimit = Number(c.req.query('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? rawLimit : Infinity;
  const guestFilter = c.req.query('guest'); // '1' 只看游客，'0' 只看注册用户，缺省全部
  let rows = listUsers();
  if (guestFilter === '1') rows = rows.filter((u) => u.isGuest);
  else if (guestFilter === '0') rows = rows.filter((u) => !u.isGuest);
  // 最新注册在前：即使调用方传了 limit，被保留的也是最新的用户，而非最旧的。
  rows = [...rows].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  return c.json(Number.isFinite(limit) ? rows.slice(0, limit) : rows);
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
