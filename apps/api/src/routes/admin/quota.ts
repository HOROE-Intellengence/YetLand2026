import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  AdminQuotaGrantSchema,
  AdminQuotaFreeLimitSchema,
  AdminQuotaSetUserSchema,
  AdminQuotaResetUserSchema,
  AdminQuotaExchangeToggleSchema,
} from '@yelan/shared';
import { store } from '../../store/persistence';
import { policyService } from '../../services/policy';
import { currentQuotaDate, getQuotaForDate, nextQuotaRefreshAt, resetQuotaForDate, setQuotaForDate } from '../../services/users';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminQuotaRoute = new Hono();

function refreshMeta(date: string) {
  return {
    mode: 'daily',
    date,
    timezone: 'UTC',
    nextRefreshAt: nextQuotaRefreshAt(),
  };
}

adminQuotaRoute.get('/', (c) => {
  const s = store.state();
  const userId = c.req.query('userId');
  const date = c.req.query('date') || currentQuotaDate();
  const freeLimit = s.freeLimitOverride ?? policyService.get<number>('DAILY_FREE_ROUND_LIMIT', 20);

  if (userId) {
    const userQuota = getQuotaForDate(userId, date);
    return c.json({
      freeLimitOverride: s.freeLimitOverride,
      freeLimit,
      refresh: refreshMeta(date),
      userQuota,
    });
  }

  const snapshots: {
    userId: string;
    date: string;
    freeUsed: number;
    freeLimit: number;
    bonusUsed: number;
    bonusLimit: number;
    remaining: number;
    userFreeLimitOverride: number | null;
  }[] = [];
  for (const [uid, dates] of Object.entries(s.quota)) {
    const row = dates[date];
    if (row) {
      const q = getQuotaForDate(uid, date);
      snapshots.push({
        userId: uid,
        date: q.date,
        freeUsed: q.freeUsed,
        freeLimit: q.freeLimit,
        bonusUsed: q.bonusUsed,
        bonusLimit: q.bonusLimit,
        remaining: q.remaining,
        userFreeLimitOverride: row.freeLimit ?? null,
      });
    }
  }
  const exhaustedUsers = snapshots.filter((q) => q.remaining <= 0).length;
  return c.json({
    freeLimitOverride: s.freeLimitOverride,
    freeLimit,
    refresh: refreshMeta(date),
    totals: {
      users: snapshots.length,
      exhaustedUsers,
      remainingRounds: snapshots.reduce((sum, q) => sum + q.remaining, 0),
    },
    quotas: snapshots,
  });
});

adminQuotaRoute.post(
  '/grant',
  zValidator('json', AdminQuotaGrantSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const date = new Date().toISOString().slice(0, 10);
    const s = store.state();
    const userQuota = (s.quota[body.userId] ??= {});
    const todayQuota = (userQuota[date] ??= { date, freeUsed: 0, bonusUsed: 0, bonusLimit: 0 });
    todayQuota.bonusLimit += body.bonusDelta;
    store.save();
    audit('quota.grant', body.userId, body.reason, body);
    return c.json({ ok: true, row: todayQuota });
  },
);

adminQuotaRoute.post(
  '/free-limit',
  zValidator('json', AdminQuotaFreeLimitSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    store.state().freeLimitOverride = body.freeLimit;
    store.save();
    audit('quota.free_limit', undefined, body.reason, body);
    return c.json({ ok: true, freeLimit: body.freeLimit });
  },
);

adminQuotaRoute.post(
  '/set-user',
  zValidator('json', AdminQuotaSetUserSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const row = setQuotaForDate(body.userId, body);
    audit('quota.set_user', body.userId, body.reason, body);
    return c.json({ ok: true, row, refresh: refreshMeta(row.date) });
  },
);

adminQuotaRoute.post(
  '/reset-user',
  zValidator('json', AdminQuotaResetUserSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const row = resetQuotaForDate(body.userId, body.date);
    audit('quota.reset_user', body.userId, body.reason, body);
    return c.json({ ok: true, row, refresh: refreshMeta(row.date) });
  },
);

adminQuotaRoute.post(
  '/exchange-toggle',
  zValidator('json', AdminQuotaExchangeToggleSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    policyService.set('EXCHANGE_ENABLED', body.enabled, body.reason);
    audit('quota.exchange_toggle', body.userId, body.reason, body);
    return c.json({ ok: true, effective: true, enabled: body.enabled });
  },
);
