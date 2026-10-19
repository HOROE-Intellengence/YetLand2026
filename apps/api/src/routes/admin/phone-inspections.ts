import { Hono } from 'hono';
import { PhoneInspectionKindSchema } from '@yelan/shared';
import { phoneInspections } from '../../phone/inspection';
import { store } from '../../store/persistence';
import { charactersService } from '../../services/characters';
import { requireAdmin } from '../../middleware/auth';
export const adminPhoneInspectionsRoute = new Hono();
function userName(userId: string) {
  const user = store.state().users[userId];
  return user?.nickname?.trim() || user?.name?.trim() || '未知用户';
}
adminPhoneInspectionsRoute.use('*', requireAdmin());
adminPhoneInspectionsRoute.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
adminPhoneInspectionsRoute.get('/worldviews', c => c.json({
  owners: phoneInspections().owners('worldview').map(owner => ({ ...owner, userName: userName(owner.userId) })),
  characters: charactersService.listAll().filter(row => row.phoneRules?.worldBook?.length).map(row => ({
    id: row.id, name: row.name, ownerUserId: row.ownerUserId, origin: row.origin,
    ownerUserName: row.ownerUserId ? userName(row.ownerUserId) : row.origin === 'user' ? '未知用户' : '平台创建',
    updatedAt: row.updatedAt, entries: row.phoneRules?.worldBook ?? [],
  })),
}));
adminPhoneInspectionsRoute.get('/', c => {
  const page = Number(c.req.query('page') || 1), kind = c.req.query('kind') || undefined;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000 || (kind && !PhoneInspectionKindSchema.safeParse(kind).success)) return c.json({ code: 'INVALID_FILTER' }, 400);
  const result = phoneInspections().list({ page, kind, userId: c.req.query('userId')?.slice(0, 128), q: c.req.query('q')?.slice(0, 200) });
  return c.json({ ...result, owners: (result.owners ?? []).map(owner => ({ ...owner, userName: userName(owner.userId) })), items: result.items.map(item => {
    const row = item as Record<string, unknown>;
    const characterIds = JSON.parse(String(row.characterIds)) as string[];
    return { ...row, userName: userName(String(row.userId)), characterIds, characterNames: characterIds.map(id=>charactersService.get(id)?.name||id) };
  }) });
});
adminPhoneInspectionsRoute.get('/:id/assets/:assetId', c => {
  const asset = phoneInspections().getAsset(c.req.param('id'),c.req.param('assetId'));
  if (!asset) return c.json({code:'NOT_FOUND'},404);
  c.header('Content-Type',asset.mime); c.header('X-Content-Type-Options','nosniff');
  c.header('Content-Security-Policy',"default-src 'none'; sandbox");
  return c.body(new Uint8Array(asset.data));
});
adminPhoneInspectionsRoute.get('/:id', c => {
  const row = phoneInspections().get(c.req.param('id'));
  return row ? c.json({ ...row, userName: userName(String(row.userId)), characterNames: row.characterIds.map(id=>charactersService.get(id)?.name||id) }) : c.json({ code: 'NOT_FOUND' }, 404);
});
