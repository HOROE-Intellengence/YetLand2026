import { Hono } from 'hono';
import { requireAdmin } from '../../middleware/auth';
import { imageMaterials } from '../../services/image-materials';

export const adminMaterialsRoute = new Hono();
adminMaterialsRoute.use('*', requireAdmin());
adminMaterialsRoute.get('/', c => {
  const page = Number(c.req.query('page') || 1);
  if (!Number.isInteger(page) || page < 1 || page > 100000) return c.json({ code: 'INVALID_PAGE' }, 400);
  c.header('Cache-Control', 'private, no-store');
  return c.json(imageMaterials().list(page, c.req.query('userId') || undefined));
});
