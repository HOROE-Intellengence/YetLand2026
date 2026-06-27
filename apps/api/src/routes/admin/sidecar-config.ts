// 侧袋 AI 配置 — /api/admin/sidecar-config
// GET                     返回 enabled + order + effectiveOrder + runtimeNotes
// PATCH                   更新 enabled 或 order，脏 order 返回 400
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { AdminSidecarConfigPatchSchema } from '@yelan/shared';
import {
  SIDECAR_KEYS,
  isValidSidecarOrder,
  getSidecarEnabledMap,
  getFullSidecarOrder,
  getEffectiveSidecarOrder,
  setSidecarEnabled,
  setSidecarOrder,
} from '../../sidecar-ai/orchestrator';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';

export const adminSidecarConfigRoute = new Hono();

const RUNTIME_NOTES = [
  'atmosphereJudge 时序由「策略」面板 TEMPERATURE_OPTIMISTIC 决定（乐观=异步供下一轮 / 同步=回复前阻塞）；quotaEnding 仅在额度耗尽时触发',
  'outputStructurer 在主 AI 回复后执行；preferenceRecorder/contextCompressor 异步不阻塞',
];

adminSidecarConfigRoute.get('/', (c) => {
  const enabled = getSidecarEnabledMap();
  const order = getFullSidecarOrder();
  const effectiveOrder = getEffectiveSidecarOrder();
  return c.json({ enabled, order, effectiveOrder, runtimeNotes: RUNTIME_NOTES });
});

adminSidecarConfigRoute.patch(
  '/',
  zValidator('json', AdminSidecarConfigPatchSchema, validationHook),
  (c) => {
    const body = c.req.valid('json');

    if (body.enabled) {
      for (const [key, value] of Object.entries(body.enabled)) {
        setSidecarEnabled(key as keyof typeof body.enabled, value);
      }
      audit('sidecar-config.enabled', Object.keys(body.enabled).join(','), body.reason, body.enabled);
    }

    if (body.order) {
      if (!isValidSidecarOrder(body.order)) {
        return c.json({
          code: 'INVALID_ORDER',
          message: 'order 必须刚好包含 5 个不重复的侧袋 key：' + SIDECAR_KEYS.join(', '),
        }, 400);
      }
      setSidecarOrder(body.order);
      audit('sidecar-config.order', body.order.join('→'), body.reason);
    }

    return c.json({
      ok: true,
      enabled: getSidecarEnabledMap(),
      order: getFullSidecarOrder(),
      effectiveOrder: getEffectiveSidecarOrder(),
      runtimeNotes: RUNTIME_NOTES,
    });
  },
);
