// Node + Hono 后台主入口
// ----------------------------------------------------------------------------
// 部署模式由 DEPLOY_MODE 决定（local | server），见 ./config/deploy-mode.ts
//   pnpm start:local    → DEPLOY_MODE=local
//   pnpm start:server   → DEPLOY_MODE=server
//   pnpm dev:mock       → 默认 local
//
// 路由签名与 apps/server 1:1 对齐；真实 LLM 走 ./llm/router 的三家 provider。
import './bootstrap-env'; // 必须最先执行：把 .env 注入 process.env
import { serve } from '@hono/node-server';
import { Server } from 'node:http';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { mockChatRoute } from './routes/chat';
import { phoneRoute } from './routes/phone';
import { apiGatewayRoute } from './routes/api-gateway';
import { developerRoute } from './routes/developer';
import { mockAuthRoute } from './routes/auth';
import { mockBillingRoute } from './routes/billing';
import { mockCharactersRoute } from './routes/characters';
import { mockSessionsRoute } from './routes/sessions';
import { voiceRoute } from './routes/voice';
import { voiceAsrAssetsRoute } from './routes/voice-asr-assets';
import { hqVoiceRoute } from './routes/voice-hq';
import { mockAchievementsRoute } from './routes/achievements';
import { mockSurveysRoute } from './routes/surveys';
import { mockEventsRoute } from './routes/events';
import { mockLogsRoute } from './routes/logs';
import { mockPayRoute } from './routes/pay';
import { mockIfCodesRoute } from './routes/if-codes';
import { mockAdminRoute } from './routes/admin';
import { mockMeRoute } from './routes/me';
import { getRouter } from './llm/create-router';
import { sidecarReady } from './sidecar-ai/client';
import { getLlmApiConfig } from './services/llm-api-inventory';
import { getDeployProfile, preflightCheck } from './config/deploy-mode';
import { requestId } from './middleware/request-id';
import { internalToken } from './middleware/internal-token';
import { logError } from './services/error-logger';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const profile = getDeployProfile();
const { fatal, warn } = preflightCheck(profile);

// ── 启动前安全自检 ──────────────────────────────────────────────────────
if (fatal.length > 0) {
  console.error('\n[mock] 启动失败 — 部署模式 = ' + profile.mode);
  for (const m of fatal) console.error('  ✗ ' + m);
  console.error('');
  process.exit(1);
}
for (const m of warn) console.warn('  ! ' + m);

const app = new Hono();

// ── 请求级 requestId ──────────────────────────────────────────────────────
app.use('*', requestId());

// ── 内部 token 验签（ADR-0009）— 默认不强制，INFRA-104 部署后翻 true ──
app.use('/api/*', internalToken());

// ── 全局错误处理 ──────────────────────────────────────────────────────────
app.onError((err, c) => {
  const requestId = (c.get('requestId') as string) ?? 'unknown';
  const userId = (c.get('userId') as string) ?? undefined;
  logError({
    ts: new Date().toISOString(),
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: 500,
    code: 'INTERNAL_ERROR',
    message: err.message,
    userId,
    stack: err.stack,
  });
  return c.json({
    code: 'INTERNAL_ERROR',
    message: err.message,
    requestId,
  }, 500);
});

// ── CORS — 由 profile 决定是否白名单 ────────────────────────────────────
// local: '*' 全开；server: 显式 CORS_ORIGINS 数组（'*' 也可显式开放，但生产不推荐）
app.use(
  '*',
  cors({
    origin: (origin) => {
      if (profile.corsOrigins === '*') return origin ?? '*';
      // 白名单匹配；origin 不在列表则返回 null 让浏览器拦
      if (!origin) return profile.corsOrigins[0] ?? '';
      return profile.corsOrigins.includes(origin) ? origin : '';
    },
    allowMethods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization', 'x-request-id', 'Accept', 'X-Device-Id', 'Idempotency-Key', 'Range'],
    exposeHeaders: ['Content-Range', 'Accept-Ranges', 'Content-Length'],
    credentials: true,
    maxAge: 86400,
  }),
);

// ── /health 公开 — 暴露当前部署 profile（不含 secret），让前端/控制台显示模式 ──
app.get('/health', (c) => {
  const router = getRouter();
  const providers = Array.from(router.providers.entries()).map(([name, p]) => ({
    name,
    ready: p.ready,
  }));
  return c.json({
    ok: true,
    name: 'yelan-api',
    deploy: {
      mode: profile.mode,
      port: profile.port,
      // 不回 host —— 服务器侧的 IP 别泄露
      enableAdminConsole: profile.enableAdminConsole,
    },
    llm: {
      hasReady: router.hasReady(),
      providers,
    },
    sidecar: (() => {
      const cfg = getLlmApiConfig('sidecar');
      return {
        ready: sidecarReady(),
        model: cfg?.model ?? (process.env.SIDECAR_MODEL || process.env.DEEPSEEK_MODEL || 'deepseek-chat'),
        baseUrl: cfg?.baseUrl ?? (process.env.SIDECAR_BASE_URL || process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'),
      };
    })(),
  });
});

app.route('/api/chat', mockChatRoute);
app.route('/api/phone', phoneRoute);
app.route('/v1', apiGatewayRoute);
app.route('/api/developer', developerRoute);
app.route('/api/auth', mockAuthRoute);
app.route('/api/billing', mockBillingRoute);
app.route('/api/characters', mockCharactersRoute);
app.route('/api/sessions', mockSessionsRoute);
// 签名下载由短效 HMAC 鉴权，必须先于 voiceRoute 的全局登录中间件挂载。
app.route('/api/voice/asr-assets', voiceAsrAssetsRoute);
app.route('/api/voice-hq', hqVoiceRoute);
app.route('/api/voice', voiceRoute);
app.route('/api/achievements', mockAchievementsRoute);
app.route('/api/surveys', mockSurveysRoute);
app.route('/api/events', mockEventsRoute);
app.route('/api/logs', mockLogsRoute);
app.route('/api/pay', mockPayRoute);
app.route('/api/if-codes', mockIfCodesRoute);
app.route('/api/admin', mockAdminRoute);
app.route('/api/me', mockMeRoute);

// ── 静态：admin 控制台 ───────────────────────────────────────────────────
// 由 profile.enableAdminConsole 控制是否暴露；生产可关掉走独立 admin 前端。
if (profile.enableAdminConsole) {
  const here = dirname(fileURLToPath(import.meta.url));
  // apps/api/src → apps/admin/
  const adminDir = resolve(here, '..', '..', 'admin');
  const adminDist = resolve(adminDir, 'dist');
  const consolePath = resolve(adminDir, 'console.html');
  const hasReactBuild = existsSync(resolve(adminDist, 'index.html'));

  // React 后台（Phase 2）：有 build 产物就走 React，否则回退到旧 HTML
  // ⚠️ 改 admin 必读：此处只读 apps/admin/dist/，绝不读 apps/admin/src/。
  //    api dev 是 `tsx watch src/index.ts`，只 watch 本包 TS，不构建 admin。
  //    所以经 8787/admin 看到的永远是上一次 build 的产物——
  //    改了 apps/admin/src/** 必须先 `pnpm --filter admin build` 才会生效。
  //    要源码即时生效请改用 5173：`pnpm --filter admin dev`（HMR，无需 build）。
  if (hasReactBuild) {
    // /admin/* 静态资源：只服务真实存在的文件（dist 是 hash 路由，没有深层路径路由）。
    app.get('/admin/*', (c) => {
      const file = c.req.path.replace(/^\/admin\/?/, '') || 'index.html';
      const filePath = resolve(adminDist, file);
      if (existsSync(filePath) && statSync(filePath).isFile()) {
        const ext = file.split('.').pop();
        if (ext === 'js') return c.body(readFileSync(filePath, 'utf8'), 200, { 'Content-Type': 'application/javascript' });
        if (ext === 'css') return c.body(readFileSync(filePath, 'utf8'), 200, { 'Content-Type': 'text/css' });
        if (ext === 'html') return c.html(readFileSync(filePath, 'utf8'));
        return c.body(readFileSync(filePath));
      }
      // ⚠️ 改名伪装关键点：查无此文件就 404，绝不回退 index.html。
      //    Caddy 把 /admin/assets/* 放行用于加载哈希资源；若这里对 /admin/assets/<乱猜>
      //    回退 HTML，扫描器一猜一个准就能拿到控制台首页，秘密入口（/KSHHT）伪装即穿帮。
      //    本应用是 hash 路由（#overview 等），不存在需要 SPA fallback 的深层 path 路由。
      return c.notFound();
    });
    app.get('/admin', (c) => c.html(readFileSync(resolve(adminDist, 'index.html'), 'utf8')));
    app.get('/admin/', (c) => c.redirect('/admin'));
  } else {
    // 无 React build：回退旧 console.html
    app.get('/admin', (c) => {
      if (!existsSync(consolePath)) return c.text('console.html not found', 404);
      return c.html(readFileSync(consolePath, 'utf8'));
    });
    app.get('/admin/', (c) => c.redirect('/admin'));
  }

  // /admin-legacy 仅保留给 DB 工具外链（DbToolsPanel → console.html#db-tools）。
  // 注入 JS 守卫：非 #db-tools 的哈希一律重定向到 React /admin，门真正关上。
  app.get('/admin-legacy', (c) => {
    if (!existsSync(consolePath)) return c.text('console.html not found', 404);
    const html = readFileSync(consolePath, 'utf8');
    const guarded = html.replace('</body>',
      `<script>!function(){var h=window.location.hash;if(h!=='#db-tools'&&h.indexOf('#db-tools-')!==0){window.location.replace('/admin'+(h||''))}}</script></body>`);
    return c.html(guarded);
  });
  app.get('/admin-legacy/', (c) => c.redirect('/admin-legacy'));
}

// ── 启动 ─────────────────────────────────────────────────────────────────
const server = serve({ fetch: app.fetch, port: profile.port, hostname: profile.host });

// 配置超时 - SSE 流式响应需要更长的超时时间，避免长对话被截断
// Node.js 默认 headersTimeout=60s 会导致长对话在 60 秒时静默断开连接
if (server instanceof Server) {
  server.headersTimeout = 0;  // 0 = 无限制，适合 SSE 长连接
  server.requestTimeout = 0;  // 0 = 无限制
  server.keepAliveTimeout = 65000;  // 65秒，比 Caddy 的 30s 更大，避免提前关闭
}

if (profile.verboseStartup) {
  console.log('  超时配置: headersTimeout=0 (无限制), keepAliveTimeout=65s');
}

if (profile.verboseStartup) {
  const router = getRouter();
  const ready = Array.from(router.providers.entries())
    .filter(([, p]) => p.ready)
    .map(([n]) => n);

  const banner = profile.mode === 'server' ? '🌐 SERVER' : '💻 LOCAL';
  console.log('');
  console.log(`  ${banner} mode  · ${profile.host}:${profile.port}`);
  if (profile.enableAdminConsole) {
    const visible = profile.mode === 'server' ? '<your-domain>/admin' : `http://localhost:${profile.port}/admin`;
    console.log(`  控制台:  ${visible}`);
  } else {
    console.log(`  控制台:  已关闭（ENABLE_ADMIN_CONSOLE=false）`);
  }
  console.log(`  CORS:    ${profile.corsOrigins === '*' ? '全开' : profile.corsOrigins.join(', ') || '未配置（白名单为空）'}`);
  console.log(`  LLM:     ${ready.length === 0 ? '无 key — 走脚本化流' : 'ready ' + ready.join(', ')}`);
  console.log('');
} else {
  console.log(`[apps/api] ${profile.mode} mode on ${profile.host}:${profile.port}`);
}
