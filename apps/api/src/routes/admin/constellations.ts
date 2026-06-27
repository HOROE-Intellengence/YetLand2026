// 星座编辑器后端 —— 独立存储的 CRUD，按角色 slug。写动作落审计。
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AdminConstellationPutSchema } from '@yelan/shared';
import { constellationsService } from '../../services/constellations';
import { charactersService } from '../../services/characters';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminConstellationsRoute = new Hono();

// 列出所有已自定义的星座（source 恒为 custom）
adminConstellationsRoute.get('/', (c) => {
  const constellations = constellationsService.listAll().map((row) => ({ ...row, source: 'custom' as const }));
  return c.json({ constellations });
});

// 载入某 slug 的星座作编辑起点：持久化优先，缺省返回内置默认（source=default）
adminConstellationsRoute.get('/:slug', (c) => {
  return c.json(constellationsService.resolveDetailed(c.req.param('slug')));
});

// 全量保存某 slug 的星座
adminConstellationsRoute.put(
  '/:slug',
  zValidator('json', AdminConstellationPutSchema, validationHook),
  (c) => {
    const slug = c.req.param('slug');
    // slug 必须对应已存在角色，避免写入孤儿数据
    if (!charactersService.get(slug)) {
      return c.json({ code: 'NOT_FOUND', message: 'character not found for slug' }, 404);
    }
    const body = c.req.valid('json');
    constellationsService.upsert(slug, { points: body.points, edges: body.edges });
    audit('constellation.update', slug, body.reason, { points: body.points, edges: body.edges });
    return c.json(constellationsService.resolveDetailed(slug));
  },
);

// 重置某 slug → 删除自定义记录，渲染回退内置默认
adminConstellationsRoute.delete('/:slug', (c) => {
  const slug = c.req.param('slug');
  const reason = c.req.query('reason') || 'reset to default';
  const ok = constellationsService.remove(slug);
  if (!ok) return c.json({ code: 'NOT_FOUND', message: 'no custom constellation to reset' }, 404);
  audit('constellation.reset', slug, reason);
  return c.json({ ok: true });
});
