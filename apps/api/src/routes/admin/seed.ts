// 一键灌示例数据 — 给后台 #setup 的"快速 seed"按钮 + scripts/seed-data.mjs 共用
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { store } from '../../store/persistence';
import { getOrCreateUserByPhone, adjustCandle } from '../../services/users';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminSeedRoute = new Hono();

const SeedSchema = z.object({
  reset: z.boolean().optional(),
  reason: z.string().min(1),
});

const DEMO_PHONES = ['13800000001', '13800000002', '13800000003'];
const DEMO_CODES = [
  { code: 'YELAN-DEMO-1', boundary: 3 as const, source: 'seed-script' },
  { code: 'YELAN-DEMO-2', boundary: 4 as const, source: 'seed-script' },
];

adminSeedRoute.post(
  '/',
  zValidator('json', SeedSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const s = store.state();

    if (body.reset) {
      s.users = {};
      s.tokenIndex = {};
      s.phoneIndex = {};
      s.quota = {};
      s.candleLedger = [];
      s.sessions = {};
      s.messages = {};
      s.conversationLogs = [];
      s.ifRedemptions = [];
      s.surveys.submissions = [];
      s.payments = [];
      s.costsDaily = [];
      audit('seed.reset', undefined, body.reason);
    }

    const created = { users: 0, codes: 0, payments: 0 };
    for (const phone of DEMO_PHONES) {
      const existed = !!s.phoneIndex[phone];
      const u = getOrCreateUserByPhone(phone);
      if (!existed) {
        created.users++;
        if (phone === DEMO_PHONES[0]) {
          adjustCandle(u.id, 50, 'achievement', 'seed:obsession');
          adjustCandle(u.id, -40, 'unlock_card', 'seed:jiang-bai');
        }
        if (phone === DEMO_PHONES[1]) {
          adjustCandle(u.id, 30, 'survey', 'seed:srv_1');
        }
      }
    }

    for (const def of DEMO_CODES) {
      if (!s.ifCodes.find((x) => x.code === def.code)) {
        s.ifCodes.push({ ...def, active: true });
        created.codes++;
      }
    }

    if (s.payments.length === 0) {
      const u = s.users[s.phoneIndex[DEMO_PHONES[0]!]!]!;
      s.payments.push({
        id: `pay_seed_${randomUUID().slice(0, 6)}`,
        provider: 'wechat',
        userId: u.id,
        amount: 28,
        status: 'active',
        ts: new Date().toISOString(),
      });
      created.payments++;
    }

    audit('seed.run', undefined, body.reason, { created });
    store.save();

    return c.json({
      ok: true,
      reset: !!body.reset,
      created,
      users: Object.values(s.users).map((u) => ({
        id: u.id, phone: u.phone, candle: u.candle, token: u.token,
      })),
    });
  },
);
