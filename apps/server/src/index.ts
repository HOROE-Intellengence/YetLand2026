// Cloudflare Workers entry. 路由按业务域拆到 routes/。
// 中间件链：requestId → cors → error → auth(可选)
import { Hono } from 'hono';
import type { Env } from './types/bindings';

import { withRequestId } from './middleware/request-id';
import { withCors } from './middleware/cors';
import { securityHeaders } from './middleware/security-headers';
import { rateLimit } from './middleware/rate-limit';
import { withErrorHandler } from './middleware/error';

import { chatRoute } from './routes/chat';
import { authRoute } from './routes/auth';
import { meRoute } from './routes/me';
import { payRoute } from './routes/pay';
import { adminRoute } from './routes/admin';
import { getMockFallbackBase, proxyToMockFallback, proxyToMockOr404 } from './routes/mock-fallback';

const app = new Hono<{ Bindings: Env }>();

app.use('*', withRequestId());
app.use('*', withCors());
app.use('*', securityHeaders());
app.use('/api/*', rateLimit());
app.use('*', withErrorHandler());

app.get('/health', async (c) => {
  const mockFallbackBase = getMockFallbackBase(c.env);
  let mockReachable: boolean | null = null;
  let mockStatus: number | null = null;

  if (mockFallbackBase) {
    try {
      const res = await fetch(`${mockFallbackBase}/health`, { signal: AbortSignal.timeout(1000) });
      mockStatus = res.status;
      mockReachable = res.ok;
    } catch {
      mockReachable = false;
    }
  }

  const ok = mockFallbackBase ? mockReachable === true : true;
  return c.json({
    ok,
    name: 'yelan-server',
    mockFallback: {
      enabled: Boolean(mockFallbackBase),
      baseUrl: mockFallbackBase,
      reachable: mockReachable,
      status: mockStatus,
    },
  }, ok ? 200 : 503);
});

// Linked dev mode: keep apps/server as the front door while delegating complete
// local-only behavior to apps/api. Production stays clean unless the
// fallback env vars are explicitly enabled.
app.use('/api/*', async (c, next) => {
  const proxied = await proxyToMockFallback(c);
  if (proxied) return proxied;
  return next();
});
app.all('/admin', proxyToMockOr404);
app.all('/admin/*', proxyToMockOr404);
app.all('/admin-legacy', proxyToMockOr404);
app.all('/admin-legacy/*', proxyToMockOr404);
app.all('/assets/*', proxyToMockOr404);

app.route('/api/chat', chatRoute);
app.route('/api/auth', authRoute);
app.route('/api/me', meRoute);
app.route('/api/pay', payRoute);
app.route('/api/admin', adminRoute);

export default app;
