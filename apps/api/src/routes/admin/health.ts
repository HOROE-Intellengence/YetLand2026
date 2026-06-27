// 后台聚合状态 — 用 1 个请求让前端"概览"页一次拿全
import { Hono } from 'hono';
import { DEFAULT_GLOBAL_BOUNDARY } from '@yelan/shared';
import { store } from '../../store/persistence';
import { getRouter } from '../../llm/create-router';
import { getDeployProfile } from '../../config/deploy-mode';
import { sidecarReady } from '../../sidecar-ai/client';
import { getLlmApiConfig } from '../../services/llm-api-inventory';

export const adminHealthRoute = new Hono();

adminHealthRoute.get('/', (c) => {
  const s = store.state();
  const router = getRouter();
  const profile = getDeployProfile();
  return c.json({
    server: {
      // 部署模式 — 控制台顶栏徽章 + 概览页都吃这个
      mode: profile.mode,
      now: new Date().toISOString(),
      port: profile.port,
      host: profile.host,
      enableAdminConsole: profile.enableAdminConsole,
      narrativeBoundaryGlobal: Number(process.env.NARRATIVE_BOUNDARY_GLOBAL ?? DEFAULT_GLOBAL_BOUNDARY),
      freeLimitOverride: s.freeLimitOverride,
    },
    llm: {
      hasReady: router.hasReady(),
      providers: Array.from(router.providers.entries()).map(([name, p]) => ({ name, ready: p.ready })),
    },
    sidecar: (() => {
      const cfg = getLlmApiConfig('sidecar');
      return {
        ready: sidecarReady(),
        model: cfg?.model ?? (process.env.SIDECAR_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
        baseUrl: cfg?.baseUrl ?? (process.env.SIDECAR_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'),
      };
    })(),
    counts: {
      users: Object.keys(s.users).length,
      sessions: Object.keys(s.sessions).length,
      messages: Object.values(s.messages).reduce((a, x) => a + x.length, 0),
      candleLedger: s.candleLedger.length,
      conversationLogs: s.conversationLogs.length,
      ifCodes: s.ifCodes.length,
      ifRedemptions: s.ifRedemptions.length,
      payments: s.payments.length,
      surveysSubs: s.surveys.submissions.length,
      promptVersions: s.prompts.versions.length,
      adminAudit: s.adminAudit.length,
    },
    costsToday: s.costsDaily.find((r) => r.date === new Date().toISOString().slice(0, 10)) ?? {
      date: new Date().toISOString().slice(0, 10),
      cost: 0,
      tokens: 0,
      calls: 0,
    },
  });
});
