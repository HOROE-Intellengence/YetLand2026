// IF 暗号兑换 — 命中后下一轮起 boundary 提升 + ifUnlocked=true
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { IfCodesRedeemSchema } from '@yelan/shared';
import { softAuth } from '../middleware/auth';
import { redeemIfCode } from '../services/if-unlock';
import { validationHook } from '../middleware/validation';

export const mockIfCodesRoute = new Hono();
mockIfCodesRoute.use('*', softAuth());

mockIfCodesRoute.post(
  '/redeem',
  zValidator('json', IfCodesRedeemSchema, validationHook),
  async (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');
    redeemIfCode(userId, body.code);
    return c.json({ accepted: true });
  },
);
