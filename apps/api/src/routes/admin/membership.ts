import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  AdminMembershipCancelSchema,
  AdminMembershipGrantSchema,
  AdminMembershipPlanPatchSchema,
} from '@yelan/shared';
import { validationHook } from '../../middleware/validation';
import {
  activateMembership,
  cancelMembership,
  listMembershipPlans,
  listSubscriptions,
  patchMembershipPlan,
} from '../../services/membership';
import { audit } from './_audit';

export const adminMembershipRoute = new Hono();

adminMembershipRoute.get('/plans', (c) => {
  return c.json({ plans: listMembershipPlans({ includeInactive: true }) });
});

adminMembershipRoute.patch(
  '/plans/:planId',
  zValidator('json', AdminMembershipPlanPatchSchema, validationHook),
  async (c) => {
    const planId = c.req.param('planId') as 'moonlight' | 'milkyway' | 'eternal';
    const body = c.req.valid('json');
    const { reason, ...patch } = body;
    const plan = patchMembershipPlan(planId, patch);
    audit('membership.plan.update', planId, reason, { planId, patch });
    return c.json({ ok: true, plan });
  },
);

adminMembershipRoute.get('/subscriptions', (c) => {
  const userId = c.req.query('userId');
  const subscriptions = listSubscriptions().filter((sub) => !userId || sub.userId === userId);
  return c.json({ subscriptions });
});

adminMembershipRoute.post(
  '/grant',
  zValidator('json', AdminMembershipGrantSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const subscription = activateMembership({
      userId: body.userId,
      planId: body.planId,
      cycle: body.cycle,
      provider: 'admin',
      gatewayEventId: `admin:${body.userId}:${Date.now()}`,
      gatewaySubscriptionId: null,
      periodDays: body.periodDays,
      candleGrantOverride: body.candleGrantOverride,
    });
    audit('membership.grant', body.userId, body.reason, body);
    return c.json({ ok: true, subscription });
  },
);

adminMembershipRoute.post(
  '/cancel',
  zValidator('json', AdminMembershipCancelSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const subscription = cancelMembership(body.userId, { immediate: body.immediate });
    audit('membership.cancel', body.userId, body.reason, body);
    return c.json({ ok: true, subscription });
  },
);
