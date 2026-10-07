// Isolated HTTP smoke test / visual QA fixture. No real users, API keys, SMS or model calls.
// node apps/api/node_modules/tsx/dist/cli.mjs apps/api/scripts/api-gateway-smoke.ts [--serve]
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ApiQuota } from '@yelan/shared';

const root = mkdtempSync(join(tmpdir(), 'yl-gateway-http-'));
process.env.YELAN_STATE_DIR = root;
process.env.API_GATEWAY_DATA_DIR = join(root, 'gateway');
process.env.DEPLOY_MODE = 'local';
process.env.ADMIN_TOKEN = 'isolated-gateway-qa-admin';
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const { store } = await import('../src/store/persistence');
const { registerWithEmail } = await import('../src/services/users');
const { gatewayDatabase } = await import('../src/gateway/service');
const { apiGatewayRoute } = await import('../src/routes/api-gateway');
const { mockAdminRoute } = await import('../src/routes/admin');
const { mockAuthRoute } = await import('../src/routes/auth');
const { developerRoute } = await import('../src/routes/developer');
const { requestId } = await import('../src/middleware/request-id');
const upstream = createServer(async (req, res) => {
  let raw = '';
  for await (const bytes of req) raw += bytes;
  const body = JSON.parse(raw);
  const text =
    body.messages[0]?.content === 'HTTP QA expression rules'
      ? '高级版测试回复。'
      : '纯净版测试回复。';
  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(
      `data: ${JSON.stringify({ id: 'qa', choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
    );
    res.end(
      `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 14, completion_tokens: 8 } })}\n\ndata: [DONE]\n\n`,
    );
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'qa',
        object: 'chat.completion',
        choices: [
          { index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 6 },
      }),
    );
  }
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
const upstreamPort = (upstream.address() as AddressInfo).port;
store.state().llmApiInventory.entries['qa-gemini'] = {
  id: 'qa-gemini',
  name: '隔离测试上游',
  enabled: true,
  protocol: 'openai-compatible',
  model: 'gemini-qa',
  baseUrl: `http://127.0.0.1:${upstreamPort}/v1`,
  apiKey: 'qa-upstream-not-a-real-secret',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
const account = await registerWithEmail(
  'api-qa@example.test',
  'Temporary-QA-Password-2026',
  'API 验收账号',
);
const app = new Hono();
app.use('*', requestId());
app.route('/v1', apiGatewayRoute);
app.route('/api/admin', mockAdminRoute);
app.route('/api/auth', mockAuthRoute);
app.route('/api/developer', developerRoute);
app.get('/health', (c) => c.json({ ok: true, deploy: { mode: 'isolated-qa' } }));
const adminDist = join(repository, 'apps/admin/dist');
app.get(
  '/admin/assets/*',
  serveStatic({ root: adminDist, rewriteRequestPath: (p) => p.replace(/^\/admin/, '') }),
);
app.get('/admin', (c) => c.html(readFileSync(join(adminDist, 'index.html'), 'utf8')));
const server = serve({ fetch: app.fetch, port: 0, hostname: '127.0.0.1' });
await once(server, 'listening');
const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const adminHeaders = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
};
const db = gatewayDatabase();
db.setSettings({ ...db.settings(), upstreamId: 'qa-gemini' });
db.saveDraft('HTTP QA expression rules', 0);
db.publish(1);
for (const tier of ['pure', 'advanced'] as const) {
  const keyRes = await fetch(`${url}/api/admin/api-gateway/keys`, {
    method: 'POST',
    headers: adminHeaders,
    body: JSON.stringify({ userId: account.user.id, name: `${tier} QA`, tier }),
  });
  assert.equal(keyRes.status, 201);
  const created = (await keyRes.json()) as { secret: string };
  for (const stream of [false, true]) {
    const r = await fetch(`${url}/v1/chat/completions/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${created.secret}` },
      body: JSON.stringify({
        model: 'gemini-qa',
        messages: [{ role: 'user', content: '这是一条隔离测试消息' }],
        stream,
      }),
    });
    assert.equal(r.status, 200);
    const result = await r.text();
    assert.ok(result.includes(tier === 'pure' ? '纯净版测试回复' : '高级版测试回复'));
    const detail = await fetch(
      `${url}/api/admin/api-gateway/calls/${r.headers.get('x-request-id')}`,
      { headers: adminHeaders },
    );
    assert.equal(detail.status, 200, 'response request ID must resolve through admin detail API');
    assert.equal(((await detail.json()) as { status: string }).status, 'succeeded');
  }
}
const overview = (await (
  await fetch(`${url}/api/admin/api-gateway/overview`, { headers: adminHeaders })
).json()) as { total: number; succeeded: number };
assert.equal(overview.total, 4);
assert.equal(overview.succeeded, 4);
const mine = (await (
  await fetch(`${url}/api/developer`, { headers: { Authorization: `Bearer ${account.token}` } })
).json()) as { keys: unknown[]; applicationEnabled: boolean; quota: ApiQuota };
assert.equal(mine.keys.length, 2);
assert.equal(mine.applicationEnabled, false);
for (const path of ['/sms/send', '/sms/verify', '/keys']) {
  const disabled = await fetch(`${url}/api/developer${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${account.token}` },
    body: JSON.stringify(
      path === '/keys' ? { name: 'must stay disabled', tier: 'pure', verificationId: 'fake' } : {},
    ),
  });
  assert.equal(
    disabled.status,
    503,
    'production routes must remain disabled without an injected SMS provider',
  );
}
const quotaResponse = await fetch(`${url}/api/developer/quota`, {
  headers: { Authorization: `Bearer ${account.token}` },
});
assert.equal(quotaResponse.status, 200);
assert.equal(quotaResponse.headers.get('cache-control'), 'no-store');
assert.deepEqual(await quotaResponse.json(), mine.quota);
assert.equal(mine.quota.total, 200);
assert.equal(mine.quota.used, 4);
assert.equal(mine.quota.remaining, 196);
assert.equal((await fetch(`${url}/api/developer/quota`)).status, 401);
const other = await registerWithEmail(
  'other-api-qa@example.test',
  'Temporary-QA-Password-2026',
  '另一个验收账号',
);
const otherHeaders = { Authorization: `Bearer ${other.token}` };
const otherKeys = (await (
  await fetch(`${url}/api/developer`, { headers: otherHeaders })
).json()) as { keys: unknown[] };
assert.equal(otherKeys.keys.length, 0);
const otherQuota = (await (
  await fetch(`${url}/api/developer/quota?userId=${account.user.id}`, { headers: otherHeaders })
).json()) as ApiQuota;
assert.equal(otherQuota.used, 0, 'query parameters cannot select another account');
assert.equal(otherQuota.remaining, 200);
assert.equal(
  (
    await fetch(`${url}/api/developer/keys/${db.keys()[0]!.id}`, {
      method: 'DELETE',
      headers: otherHeaders,
    })
  ).status,
  404,
);
assert.equal((await fetch(`${url}/api/auth/verify`, { method: 'POST' })).status, 503);
assert.equal((await fetch(`${url}/api/admin/api-gateway/keys`)).status, 401);
console.log(
  JSON.stringify({
    result: 'PASS',
    calls: overview.total,
    succeeded: overview.succeeded,
    admin: `${url}/admin#api-overview`,
    testAdminToken: process.argv.includes('--serve') ? process.env.ADMIN_TOKEN : undefined,
    isolationRoot: root,
  }),
);
if (process.argv.includes('--serve')) {
  process.on('SIGINT', () => {
    server.close();
    upstream.close();
    db.close();
    process.exit(0);
  });
} else {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await new Promise<void>((resolve) => upstream.close(() => resolve()));
  db.close();
  // Timer-backed state saves are confined to this disposable root. Leave files for diagnostics.
  process.exit(0);
}
