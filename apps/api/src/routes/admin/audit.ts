// 审计日志查询 — 所有 admin 写动作都通过 _audit.audit() 落审计，统一经 adminAuditRepo
import { Hono } from 'hono';
import { adminAuditRepo } from '../../store/repositories';

export const adminAuditRoute = new Hono();

adminAuditRoute.get('/', async (c) => {
  const rawLimit = c.req.query('limit');
  const rawOffset = c.req.query('offset');
  const { rows, total } = await adminAuditRepo.query({
    action: c.req.query('action'),
    limit: rawLimit !== undefined ? Number(rawLimit) : undefined,
    offset: rawOffset !== undefined ? Number(rawOffset) : undefined,
  });
  return c.json({ rows, total });
});
