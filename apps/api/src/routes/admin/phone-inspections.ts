import { Hono } from 'hono';
import { PhoneInspectionKindSchema } from '@yelan/shared';
import { phoneInspections } from '../../phone/inspection';
import { store } from '../../store/persistence';
import { charactersService } from '../../services/characters';
import { requireAdmin } from '../../middleware/auth';
export const adminPhoneInspectionsRoute = new Hono();
adminPhoneInspectionsRoute.use('*', requireAdmin());
adminPhoneInspectionsRoute.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
adminPhoneInspectionsRoute.get('/worldviews', c => c.json({
  characters: charactersService.listAll().filter(row => row.phoneRules?.worldBook?.length).map(row => ({
    id: row.id, name: row.name, ownerUserId: row.ownerUserId, origin: row.origin,
    updatedAt: row.updatedAt, entries: row.phoneRules?.worldBook ?? [],
  })),
}));
adminPhoneInspectionsRoute.get('/', c => {
  const page = Number(c.req.query('page') || 1), kind = c.req.query('kind') || undefined;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || (kind && !PhoneInspectionKindSchema.safeParse(kind).success)) return c.json({ code: 'INVALID_FILTER' }, 400);
  const result = phoneInspections().list({ page, kind, userId: c.req.query('userId')?.slice(0, 128), q: c.req.query('q')?.slice(0, 200) });
  return c.json({ ...result, items: result.items.map(item => {
    const row = item as Record<string, unknown>, user = store.state().users[String(row.userId)];
    return { ...row, userName: user?.nickname || user?.name || String(row.userId), characterIds: JSON.parse(String(row.characterIds)) };
  }) });
});
adminPhoneInspectionsRoute.get('/:id', c => {
  const row = phoneInspections().get(c.req.param('id'));
  return row ? c.json(row) : c.json({ code: 'NOT_FOUND' }, 404);
});
