// BE-104 — /api/admin/policy
// GET           列出全部策略（或 ?grouped=1 分组返回）
// PATCH /:key   更新单个策略值（原因必填，落审计）
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AdminPolicyPatchSchema } from '@yelan/shared';
import { policyService, clearPolicyCache } from '../../services/policy';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminPolicyRoute = new Hono();

adminPolicyRoute.get('/', (c) => {
  const grouped = c.req.query('grouped') === '1';
  if (grouped) return c.json({ groups: policyService.listByGroup() });
  return c.json({ policies: policyService.listAll() });
});

adminPolicyRoute.patch('/:key', zValidator('json', AdminPolicyPatchSchema, validationHook), (c) => {
  const key = c.req.param('key');
  const body = c.req.valid('json');
  try {
    const row = policyService.set(key, body.value, body.reason);
    clearPolicyCache(); // 下一轮对话立即生效
    audit('policy.update', key, body.reason, { value: row.value });
    return c.json(row);
  } catch (e) {
    if (policyService.isPolicyValidationError(e)) {
      return c.json({ code: e.code, message: e.message }, 400);
    }
    throw e;
  }
});
