import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import {
  ApiKeyCreateSchema,
  ApiKeyPatchSchema,
  ApiGatewaySettingsSchema,
  ApiPreludeDraftSchema,
  ApiPreludePublishSchema,
  ApiPreludeRollbackSchema,
} from '@yelan/shared';
import type { z } from 'zod';
import { GatewayError } from '../../gateway/database';
import type { CallFilter } from '../../gateway/database';
import { defaultGatewayDependencies } from '../api-gateway';
import type { GatewayDependencies } from '../api-gateway';
import { listLlmApis } from '../../services/llm-api-inventory';
import { store } from '../../store/persistence';
import { chatMessages, type ChatRow } from '../../gateway/conversations';

async function parse<T extends z.ZodTypeAny>(
  request: { json: () => Promise<unknown> },
  schema: T,
): Promise<z.infer<T>> {
  let json;
  try {
    json = await request.json();
  } catch {
    throw new GatewayError('INVALID_JSON', 400, '请求必须为 JSON');
  }
  const value = schema.safeParse(json);
  if (!value.success)
    throw new GatewayError(
      'INVALID_REQUEST',
      400,
      value.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  return value.data;
}
export function callFilter(query: Record<string, string>): CallFilter {
  const from = query.from ?? new Date(Date.now() - 7 * 86400000).toISOString();
  const to = query.to ?? new Date().toISOString();
  if (
    !Number.isFinite(Date.parse(from)) ||
    !Number.isFinite(Date.parse(to)) ||
    Date.parse(from) > Date.parse(to)
  )
    throw new GatewayError('INVALID_RANGE', 400, '时间范围无效');
  if (query.tier && query.tier !== 'pure' && query.tier !== 'advanced')
    throw new GatewayError('INVALID_TIER', 400, '版本无效');
  return {
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    tier: query.tier as CallFilter['tier'],
    userId: query.userId || undefined,
    keyId: query.keyId || undefined,
  };
}
export function createAdminGatewayRoute(deps: GatewayDependencies = defaultGatewayDependencies) {
  // Mounted below the existing requireAdmin middleware, never on /v1.
  const route = new Hono();
  route.use('*', bodyLimit({ maxSize: 256 * 1024 }));
  route.onError((e, c) => {
    const err =
      e instanceof GatewayError
        ? e
        : new GatewayError('GATEWAY_STORAGE_ERROR', 500, '操作失败，请检查 API 存储');
    return c.json({ code: err.code, message: err.message }, err.status);
  });
  route.get('/settings', (c) =>
    c.json({
      settings: deps.db().settings(),
      smsEnabled: false,
      baseUrl: 'https://yetland.cn/v1',
      upstreams: listLlmApis()
        .entries.filter((e) => e.protocol === 'openai-compatible' && /^gemini-/i.test(e.model))
        .map((e) => ({ id: e.id, name: e.name, model: e.model, ready: e.ready })),
    }),
  );
  route.put('/settings', async (c) => {
    const settings = await parse(c.req, ApiGatewaySettingsSchema);
    deps.upstream(settings.upstreamId);
    deps.db().setSettings(settings);
    return c.json({ ok: true });
  });
  route.get('/users', (c) =>
    c.json({
      users: Object.keys(store.state().users)
        .map((id) => deps.user(id))
        .filter((u) => u && !u.deletedAt && !u.isGuest)
        .map((u) => ({
          id: u!.id,
          name: u!.name ?? '',
          phone: u!.phone ? u!.phone.slice(0, 3) + '****' + u!.phone.slice(-4) : '',
          email: u!.email ? u!.email.replace(/^(.).+(@.*)$/, '$1***$2') : '',
        })),
    }),
  );
  route.get('/keys', (c) => c.json({ keys: deps.db().keys(c.req.query('userId')) }));
  route.post('/keys', async (c) => {
    const input = await parse(c.req, ApiKeyCreateSchema);
    const user = deps.user(input.userId);
    if (!user || user.deletedAt || user.isGuest)
      throw new GatewayError('USER_NOT_FOUND', 400, '请选择有效的注册账号');
    if (input.expiresAt && Date.parse(input.expiresAt) <= Date.now())
      throw new GatewayError('INVALID_EXPIRY', 400, '过期时间必须在未来');
    c.header('Cache-Control', 'no-store');
    return c.json(deps.db().createTestKey(user, input), 201);
  });
  route.patch('/keys/:id', async (c) => {
    const input = await parse(c.req, ApiKeyPatchSchema);
    deps.db().patchKey(c.req.param('id'), input);
    return c.json({ key: deps.db().keyView(c.req.param('id')) });
  });
  route.get('/prelude', (c) => c.json(deps.db().prelude()));
  route.put('/prelude/draft', async (c) => {
    const body = await parse(c.req, ApiPreludeDraftSchema);
    deps.db().saveDraft(body.content, body.revision);
    return c.json(deps.db().prelude());
  });
  route.post('/prelude/publish', async (c) => {
    const body = await parse(c.req, ApiPreludePublishSchema);
    deps.db().publish(body.revision);
    return c.json(deps.db().prelude());
  });
  route.post('/prelude/rollback', async (c) => {
    const body = await parse(c.req, ApiPreludeRollbackSchema);
    deps.db().publish(body.revision, body.versionId);
    return c.json(deps.db().prelude());
  });
  route.get('/overview', (c) => c.json(deps.db().overview(callFilter(c.req.query()))));
  route.get('/calls', (c) => {
    const offset = Number(c.req.query('offset') ?? 0);
    if (!Number.isInteger(offset) || offset < 0)
      throw new GatewayError('INVALID_OFFSET', 400, '分页参数无效');
    return c.json(deps.db().calls(callFilter(c.req.query()), offset));
  });
  route.get('/conversations/:keyId', (c) => {
    const db = deps.db();
    const keyId = c.req.param('keyId');
    if (!db.key(keyId)) throw new GatewayError('NOT_FOUND', 404, 'Key 不存在');
    const filter = db.filter(callFilter({ ...c.req.query(), keyId }));
    const cursor = c.req.query('before');
    const previous = cursor ? db.call(cursor) : undefined;
    if (cursor && (!previous || previous.keyId !== keyId))
      throw new GatewayError('INVALID_CURSOR', 400, '分页位置无效');
    const rows = db.db
      .prepare(
        `SELECT id,request,outputText,createdAt FROM calls c WHERE ${filter.sql}
       ${previous ? 'AND (createdAt<? OR (createdAt=? AND id<?))' : ''}
       ORDER BY createdAt DESC,id DESC LIMIT 51`,
      )
      .all(
        ...filter.args,
        ...(previous ? [previous.createdAt, previous.createdAt, previous.id] : []),
      ) as ChatRow[];
    const page = rows.slice(0, 50);
    const nextCursor = rows.length > 50 ? page[page.length - 1]!.id : null;
    db.audit('conversation.read', keyId);
    c.header('Cache-Control', 'no-store');
    return c.json({ messages: page.reverse().flatMap(chatMessages), nextCursor });
  });
  route.get('/records/export', (c) => {
    const db = deps.db();
    const query = c.req.query();
    const filter = db.filter(callFilter(query));
    const chatOnly = query.format === 'chat';
    if (chatOnly && !query.keyId) throw new GatewayError('KEY_REQUIRED', 400, '请先选择 Key');
    const count = db.db
      .prepare(`SELECT COUNT(*) n FROM calls c WHERE ${filter.sql}`)
      .get(...filter.args) as { n: number };
    if (count.n > 1000)
      throw new GatewayError('EXPORT_TOO_LARGE', 400, '记录超过 1000 条，请缩小时间范围后导出');
    const rows = db.db
      .prepare(
        `SELECT id,userId,keyId,tier,model,promptVersion,status,errorCode,httpStatus,durationMs,inputTokens,outputTokens,request,outputText,createdAt FROM calls c WHERE ${filter.sql} ORDER BY createdAt,id`,
      )
      .all(...filter.args) as (ChatRow & { userId: string; keyId: string })[];
    db.audit(
      chatOnly ? 'conversation.export' : 'records.export',
      JSON.stringify({ ...query, count: count.n }),
    );
    c.header('Cache-Control', 'no-store');
    c.header('Content-Type', chatOnly ? 'text/plain; charset=utf-8' : 'application/x-ndjson');
    c.header(
      'Content-Disposition',
      `attachment; filename="yetland-api-${chatOnly ? 'chat.txt' : 'records.jsonl'}"`,
    );
    return c.body(
      chatOnly
        ? rows
            .flatMap(chatMessages)
            .map((m) => `${m.role === 'user' ? '用户' : 'AI'}：\n${m.content}`)
            .join('\n\n')
        : rows.map((r) => JSON.stringify({ ...r, request: JSON.parse(r.request) })).join('\n'),
    );
  });
  route.get('/calls/:id', (c) => {
    const db = deps.db();
    const row = db.call(c.req.param('id'));
    if (!row) throw new GatewayError('NOT_FOUND', 404, '调用不存在');
    db.audit('call.detail.read', row.id);
    c.header('Cache-Control', 'no-store');
    return c.json({
      ...row,
      identity: JSON.parse(row.identity),
      request: JSON.parse(row.request),
      upstreamRequest: JSON.parse(row.upstreamRequest),
      response: row.response ?? db.rawResponse(row.id),
      verification: db.key(row.keyId)?.verification,
      verifiedPhone: db.key(row.keyId)?.verifiedPhone,
    });
  });
  route.get('/export', (c) => {
    const db = deps.db();
    const filter = db.filter(callFilter(c.req.query()));
    // Test keys carry no training permission. Never export account PII to a training file.
    const records = db.db
      .prepare(
        `SELECT id,tier,model,promptVersion,request,response,outputText,createdAt FROM calls c WHERE ${filter.sql} AND status='succeeded' AND trainingConsent=1 ORDER BY createdAt LIMIT 10000`,
      )
      .all(...filter.args) as { request: string; [k: string]: unknown }[];
    db.audit('training.export', String(records.length));
    c.header('Content-Type', 'application/x-ndjson');
    c.header('Content-Disposition', 'attachment; filename="yetland-api-training.jsonl"');
    c.header('Cache-Control', 'no-store');
    return c.body(
      records
        .map((r) =>
          JSON.stringify({
            ...r,
            request: JSON.parse(r.request),
            provenance: { history: 'client_supplied', output: 'upstream_observed' },
          }),
        )
        .join('\n'),
    );
  });
  return route;
}
export const adminApiGatewayRoute = createAdminGatewayRoute();
