// /api/me/* — 账户管理（Phase 2/3/4 桩，对齐 apps/api/src/routes/me.ts）
// 当前阶段：全部 501 NOT_IMPLEMENTED；schema 已用 zod 校验，确保前端调用契约不漂移
import { Hono } from 'hono';
import {
  MeNamePatchSchema,
  MeProfilePatchSchema,
  MePasswordSetSchema,
  MePhoneChangeSchema,
  MeAccountDeleteSchema,
  MeEmailBindSchema,
} from '@yelan/shared';
import type { Env } from '../types/bindings';

export const meRoute = new Hono<{ Bindings: Env }>();

function notImplemented(c: any, op: string) {
  return c.json(
    {
      code: 'NOT_IMPLEMENTED',
      message: `${op} not yet on apps/server; mock-fallback delegates to apps/api.`,
      phase: 'feat/user-account',
    },
    501,
  );
}

meRoute.get('/', async (c) => notImplemented(c, 'GET /api/me'));

meRoute.patch('/name', async (c) => {
  const body = MeNamePatchSchema.parse(await c.req.json());
  void body;
  return notImplemented(c, 'PATCH /api/me/name');
});

meRoute.patch('/profile', async (c) => {
  const body = MeProfilePatchSchema.parse(await c.req.json());
  void body;
  // CRITICAL: 实现必须 requireAuth（不能 softAuth）—— stale token 不能
  // 静默降级到匿名号并污染共享 nickname/email。参见 codex 抓到的 P1
  // 与 apps/api/src/__tests__/p1-regressions.test.ts。
  return notImplemented(c, 'PATCH /api/me/profile');
});

meRoute.post('/password', async (c) => {
  const body = MePasswordSetSchema.parse(await c.req.json());
  void body;
  return notImplemented(c, 'POST /api/me/password');
});

meRoute.post('/phone/change', async (c) => {
  const body = MePhoneChangeSchema.parse(await c.req.json());
  void body;
  return notImplemented(c, 'POST /api/me/phone/change');
});

meRoute.post('/sessions/revoke-all', async (c) =>
  notImplemented(c, 'POST /api/me/sessions/revoke-all'),
);

meRoute.post('/delete', async (c) => {
  const body = MeAccountDeleteSchema.parse(await c.req.json());
  void body;
  return notImplemented(c, 'POST /api/me/delete');
});

meRoute.post('/email/bind', async (c) => {
  const body = MeEmailBindSchema.parse(await c.req.json());
  void body;
  // CRITICAL: 实现必须 requireAuth；email normalize（trim+lower）后查 emailIndex；
  // 无密码用户必须同时传 password（否则绑完没用，等于半成品）。
  // 唯一性冲突 → 409 EMAIL_TAKEN。
  return notImplemented(c, 'POST /api/me/email/bind');
});
