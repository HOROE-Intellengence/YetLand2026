import { Hono } from 'hono';
import { requireAdmin } from '../../middleware/auth';
import { imageMaterials } from '../../services/image-materials';

export const adminMaterialsRoute = new Hono();
adminMaterialsRoute.use('*', requireAdmin());
adminMaterialsRoute.get('/', c => {
  const page = Number(c.req.query('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100000) return c.json({ code: 'INVALID_PAGE' }, 400);
  c.header('Cache-Control', 'private, no-store');
  return c.json(imageMaterials().list(page, c.req.query('userId') || undefined, c.req.query('source') || undefined));
});
adminMaterialsRoute.get('/:id/content', c => {
  const file=imageMaterials().get(c.req.param('id'));
  if(!file)return c.json({code:'NOT_FOUND'},404);
  c.header('Cache-Control','private, no-store');
  c.header('Content-Type',file.mime);c.header('X-Content-Type-Options','nosniff');
  c.header('Content-Security-Policy',"default-src 'none'; sandbox");
  if(c.req.query('download')==='1')c.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.fileName || file.id)}`);
  return c.body(new Uint8Array(file.data));
});
