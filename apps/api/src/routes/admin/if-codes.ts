// IF 暗号管理 — 与 /api/if-codes/redeem 配套
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AdminIfCodesCreateSchema, AdminIfCodesToggleSchema } from '@yelan/shared';
import { store } from '../../store/persistence';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminIfCodesRoute = new Hono();

adminIfCodesRoute.get('/', (c) => {
  const s = store.state();
  return c.json({ codes: s.ifCodes, redemptions: s.ifRedemptions });
});

adminIfCodesRoute.post(
  '/',
  zValidator('json', AdminIfCodesCreateSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const code = body.code.trim().toUpperCase();
    const s = store.state();
    if (s.ifCodes.find((x) => x.code === code)) {
      return c.json({ code: 'EXISTS', message: 'code already exists' }, 409);
    }
    s.ifCodes.push({
      code,
      boundary: body.boundary,
      source: body.source,
      active: true,
      ...(body.temperature != null ? { temperature: body.temperature } : {}),
    });
    store.save();
    audit('if-code.create', code, body.reason, body);
    return c.json({ ok: true });
  },
);

adminIfCodesRoute.patch(
  '/:code',
  zValidator('json', AdminIfCodesToggleSchema, validationHook),
  async (c) => {
    const code = c.req.param('code').toUpperCase();
    const body = c.req.valid('json');
    const s = store.state();
    const def = s.ifCodes.find((x) => x.code === code);
    if (!def) return c.json({ code: 'NOT_FOUND', message: 'not found' }, 404);
    def.active = body.active;
    store.save();
    audit('if-code.toggle', code, body.reason, { active: body.active });
    return c.json({ ok: true });
  },
);

adminIfCodesRoute.delete('/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const reason = c.req.query('reason') || 'no reason';
  const s = store.state();
  const before = s.ifCodes.length;
  s.ifCodes = s.ifCodes.filter((x) => x.code !== code);
  if (s.ifCodes.length === before) return c.json({ code: 'NOT_FOUND', message: 'not found' }, 404);
  store.save();
  audit('if-code.delete', code, reason);
  return c.json({ ok: true });
});
