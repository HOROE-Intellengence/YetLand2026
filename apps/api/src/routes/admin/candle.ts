import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AdminCandleGrantSchema } from '@yelan/shared';
import { adjustCandle, getCandleLedger } from '../../services/users';
import { store } from '../../store/persistence';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminCandleRoute = new Hono();

adminCandleRoute.post(
  '/grant',
  zValidator('json', AdminCandleGrantSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const r = adjustCandle(body.userId, body.delta, 'admin_grant', body.refId ?? body.reason);
    audit('candle.grant', body.userId, body.reason, body);
    return c.json({ ok: true, balance: r.balance });
  },
);

adminCandleRoute.get('/ledger', (c) => {
  const userId = c.req.query('userId');
  if (userId) return c.json(getCandleLedger(userId));
  return c.json(store.state().candleLedger);
});
