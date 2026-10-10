import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { ApiCompletionSchema, API_PUBLIC_MODELS } from '@yelan/shared';
import { type GatewayDatabase, GatewayError } from '../gateway/database';
import type { Identity, KeyRow } from '../gateway/database';
import { gatewayDatabase, accountIdentity, gatewayUpstream } from '../gateway/service';
import type { Upstream } from '../gateway/service';
import { forwardCompletion } from '../gateway/forward';

export interface GatewayDependencies {
  db: () => GatewayDatabase;
  user: (id: string) => Identity | undefined;
  upstream: (id: string) => Upstream;
  fetcher?: typeof fetch;
}
export const defaultGatewayDependencies: GatewayDependencies = {
  db: gatewayDatabase,
  user: accountIdentity,
  upstream: gatewayUpstream,
};
export function createGatewayRoute(deps = defaultGatewayDependencies) {
  const route = new Hono<{ Variables: { apiKey: KeyRow } }>({ strict: false });
  route.onError((e, c) => {
    const err =
      e instanceof GatewayError ? e : new GatewayError('INTERNAL_ERROR', 500, 'API 服务暂时不可用');
    if (err.status === 429) c.header('Retry-After', '60');
    return c.json(
      {
        error: {
          code: err.code,
          type: err.status === 401 ? 'authentication_error' : 'api_error',
          message: err.message,
        },
      },
      err.status,
    );
  });
  route.use(
    '*',
    bodyLimit({
      maxSize: 2 * 1024 * 1024,
      onError: (c) =>
        c.json(
          {
            error: {
              code: 'REQUEST_TOO_LARGE',
              message: '请求不能超过 2 MiB',
              type: 'invalid_request_error',
            },
          },
          413,
        ),
    }),
  );
  route.use('*', async (c, next) => {
    const token = c.req.header('authorization')?.match(/^Bearer\s+(yl_[A-Za-z0-9_-]{43})$/i)?.[1];
    const key = token ? deps.db().keyBySecret(token) : undefined;
    const user = key && deps.user(key.userId);
    if (
      !key ||
      key.status !== 'active' ||
      (key.expiresAt && key.expiresAt <= new Date().toISOString()) ||
      !user ||
      user.deletedAt ||
      user.isGuest
    )
      throw new GatewayError('INVALID_API_KEY', 401, 'Key 无效、已停用或已过期');
    c.set('apiKey', key);
    await next();
  });
  route.on('GET', ['/models', '/models/'], (c) => {
    const db = deps.db();
    if (!db.settings().enabled) throw new GatewayError('GATEWAY_DISABLED', 503, 'API 服务暂时停用');
    deps.upstream(db.settings().upstreamId);
    c.header('Cache-Control', 'no-store');
    return c.json({
      object: 'list',
      data: [
        {
          id: API_PUBLIC_MODELS[c.get('apiKey').tier],
          object: 'model',
          created: 0,
          owned_by: 'yetland',
        },
      ],
    });
  });
  route.on('POST', ['/chat/completions', '/chat/completions/'], async (c) => {
    let json: unknown;
    try {
      json = await c.req.json();
    } catch {
      throw new GatewayError('INVALID_JSON', 400, '请求必须为 JSON');
    }
    const parsed = ApiCompletionSchema.safeParse(json);
    if (!parsed.success)
      throw new GatewayError('INVALID_REQUEST', 400, '需要 model、messages 和可选的布尔 stream');
    const db = deps.db();
    const response = await forwardCompletion(
      db,
      c.get('apiKey'),
      parsed.data,
      deps.upstream(db.settings().upstreamId),
      c.req.raw.signal,
      deps.fetcher,
    );
    // Hono merges headers already staged by the parent requestId middleware.
    // Keep the public ID identical to the durable call ID, rather than its parent placeholder.
    const callId = response.headers.get('x-request-id');
    if (callId) {
      c.set('requestId', callId);
      c.header('x-request-id', callId);
    }
    return response;
  });
  route.notFound((c) =>
    c.json(
      { error: { code: 'NOT_FOUND', message: '接口不存在', type: 'invalid_request_error' } },
      404,
    ),
  );
  return route;
}
export const apiGatewayRoute = createGatewayRoute();
