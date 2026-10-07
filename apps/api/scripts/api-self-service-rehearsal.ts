// Persistent, loopback-only rehearsal. Never mounted by the production entrypoint.
// Run: node apps/api/node_modules/tsx/dist/cli.mjs apps/api/scripts/api-self-service-rehearsal.ts
// Reopen retained records without repeating tests: ... --resume <archive-directory>
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt, randomUUID, createHash } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import type { ApiKeyView, ApiChatPage, ApiQuota } from '@yelan/shared';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const resume = process.argv.indexOf('--resume');
const archive =
  resume >= 0
    ? resolve(process.argv[resume + 1]!)
    : join(
        repository,
        '.server/self-service-rehearsals',
        new Date().toISOString().replace(/[:.]/g, '-'),
      );
mkdirSync(archive, { recursive: true });
process.env.YELAN_STATE_DIR = archive;
process.env.API_GATEWAY_DATA_DIR = join(archive, 'gateway');
process.env.DEPLOY_MODE = 'local';
const accessPath = join(archive, 'local-access.json');
const access = existsSync(accessPath)
  ? JSON.parse(readFileSync(accessPath, 'utf8'))
  : {
      adminToken: `rehearsal-${randomUUID()}`,
      password: `Rehearsal-${randomUUID()}!`,
    };
process.env.ADMIN_TOKEN = access.adminToken;
writeFileSync(accessPath, JSON.stringify(access, null, 2));
const { createDeveloperRoute } = await import('../src/routes/developer');
const { gatewayDatabase } = await import('../src/gateway/service');
const { GatewayError } = await import('../src/gateway/database');
const { apiGatewayRoute } = await import('../src/routes/api-gateway');
const { mockAdminRoute } = await import('../src/routes/admin');
const { mockAuthRoute } = await import('../src/routes/auth');
const { mockMeRoute } = await import('../src/routes/me');
const { requestId } = await import('../src/middleware/request-id');
const { store } = await import('../src/store/persistence');
type Challenge = {
  id: string;
  userId: string;
  phone: string;
  hash: string;
  created: number;
  attempts: number;
  used: boolean;
};
const smsPath = join(archive, 'simulated-sms.json');
const challenges: Challenge[] = existsSync(smsPath)
  ? JSON.parse(readFileSync(smsPath, 'utf8'))
  : [];
const outboxPath = join(archive, 'simulated-outbox.json');
const outbox: { id: string; phone: string; code: string }[] = existsSync(outboxPath)
  ? JSON.parse(readFileSync(outboxPath, 'utf8'))
  : [];
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const saveSms = () => {
  writeFileSync(smsPath, JSON.stringify(challenges, null, 2));
  writeFileSync(outboxPath, JSON.stringify(outbox, null, 2));
};
const sms = {
  async send(userId: string, phone: string) {
    if (
      challenges.some(
        (c) => c.userId === userId && c.phone === phone && Date.now() - c.created < 60000,
      )
    )
      throw new GatewayError('SMS_RATE_LIMIT', 429, '请稍后再发送验证码');
    const id = randomUUID(),
      code = String(randomInt(100000, 1000000));
    challenges.push({
      id,
      userId,
      phone,
      hash: hash(code),
      created: Date.now(),
      attempts: 0,
      used: false,
    });
    outbox.push({ id, phone, code });
    saveSms();
    return { challengeId: id };
  },
  async verify(userId: string, id: string, code: string) {
    const challenge = challenges.find((c) => c.id === id && c.userId === userId);
    if (
      !challenge ||
      challenge.used ||
      Date.now() - challenge.created > 300000 ||
      challenge.attempts >= 5
    )
      throw new GatewayError('INVALID_CODE', 400, '验证码已失效');
    challenge.attempts++;
    if (challenge.hash !== hash(code)) {
      saveSms();
      throw new GatewayError('INVALID_CODE', 400, '验证码错误');
    }
    challenge.used = true;
    saveSms();
    return { phone: challenge.phone };
  },
};
const upstream = createServer(async (req, res) => {
  let raw = '';
  for await (const bytes of req) raw += bytes;
  const body = JSON.parse(raw);
  const latest = body.messages.filter((m: { role: string }) => m.role === 'user').at(-1)?.content;
  const text = `【模拟模型回复】${latest === '接下来怎么做？' ? '接下来将常用物品归位，留出工作空间。' : '先将桌面物品分类，再清洁桌面。'}`;
  const usage = { prompt_tokens: 20, completion_tokens: 12 };
  if (body.stream) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const content of [text.slice(0, 10), text.slice(10)])
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`);
    res.end(`data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`);
  } else {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: randomUUID(),
        choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
        usage,
      }),
    );
  }
});
upstream.listen(0, '127.0.0.1');
await once(upstream, 'listening');
store.state().llmApiInventory.entries['rehearsal-gemini'] = {
  id: 'rehearsal-gemini',
  name: '隔离模拟模型（非真实 Gemini）',
  enabled: true,
  protocol: 'openai-compatible',
  model: 'gemini-rehearsal',
  baseUrl: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`,
  apiKey: 'simulation-only',
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};
store.saveNow();
const db = gatewayDatabase();
db.setSettings({ ...db.settings(), upstreamId: 'rehearsal-gemini' });
if (!db.published()) {
  const p = db.prelude();
  db.saveDraft('这是隔离自助申请演练，请用简洁中文回答。', p.revision);
  db.publish(p.revision + 1);
}
const port = 13434;
const base = `http://127.0.0.1:${port}`;
const app = new Hono();
app.use('*', requestId());
app.route('/api/auth', mockAuthRoute);
app.route('/api/me', mockMeRoute);
app.route('/api/developer', createDeveloperRoute({ sms, simulation: true, baseUrl: `${base}/v1` }));
app.route('/v1', apiGatewayRoute);
app.route('/api/admin', mockAdminRoute);
app.get('/health', (c) =>
  c.json({ ok: true, simulation: true, deploy: { mode: 'isolated-rehearsal' } }),
);
const adminDist = join(repository, 'apps/admin/dist');
const webDist = join(repository, 'apps/web/dist');
app.get(
  '/admin/assets/*',
  serveStatic({ root: adminDist, rewriteRequestPath: (p) => p.replace(/^\/admin/, '') }),
);
app.get('/admin', (c) => c.html(readFileSync(join(adminDist, 'index.html'), 'utf8')));
app.get('/assets/*', serveStatic({ root: webDist }));
app.get('/', (c) => c.html(readFileSync(join(webDist, 'index.html'), 'utf8')));
const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port });
await once(server, 'listening');
const manifest = {
  archive,
  base,
  admin: `${base}/admin#api-overview`,
  user: `${base}/?api=${encodeURIComponent(base)}`,
  accessFile: accessPath,
  simulation: true,
};
writeFileSync(join(archive, 'manifest.json'), JSON.stringify(manifest, null, 2));
writeFileSync(
  join(repository, '.server/self-service-rehearsals/latest.json'),
  JSON.stringify(manifest, null, 2),
);

async function run() {
  const steps: { step: string; status: number }[] = [];
  async function request(
    path: string,
    token?: string,
    body?: unknown,
    expected = 200,
    step = path,
  ) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    steps.push({ step, status: response.status });
    assert.equal(response.status, expected, step);
    return response;
  }
  const accounts = [];
  for (const [name, email] of [
    ['模拟自助申请甲', 'self-service-a@example.test'],
    ['模拟自助申请乙', 'self-service-b@example.test'],
  ]) {
    accounts.push(
      (await (
        await request('/api/auth/email/register', undefined, {
          name,
          email,
          password: access.password,
        })
      ).json()) as { token: string; me: { id: string } },
    );
  }
  access.accounts = accounts.map((account, i) => ({
    userId: account.me.id,
    email: `self-service-${i ? 'b' : 'a'}@example.test`,
    token: account.token,
  }));
  const [a, b] = accounts;
  await request('/api/developer', undefined, undefined, 401, '未登录不能申请');
  await request(
    '/api/developer/keys',
    a!.token,
    { tier: 'pure', verificationId: 'fake' },
    400,
    '名称必填',
  );
  await request(
    '/api/developer/keys',
    a!.token,
    { name: '模拟 Key', tier: 'pure', verificationId: 'fake' },
    400,
    '伪造核验凭据被拒绝',
  );
  async function verify(token: string, phone: string, negative = false) {
    const { challengeId } = (await (
      await request('/api/developer/sms/send', token, { phone })
    ).json()) as { challengeId: string };
    const code = outbox.find((message) => message.id === challengeId)!.code;
    if (negative) {
      await request('/api/developer/sms/send', token, { phone }, 429, '验证码发送冷却');
      await request(
        '/api/developer/sms/verify',
        token,
        { challengeId, code: '000000' },
        400,
        '错误验证码被拒绝',
      );
      await request(
        '/api/developer/sms/verify',
        b!.token,
        { challengeId, code },
        400,
        '跨账号核验被拒绝',
      );
    }
    const verified = (await (
      await request('/api/developer/sms/verify', token, { challengeId, code })
    ).json()) as { verificationId: string };
    await request('/api/developer/sms/verify', token, { challengeId, code }, 400, '验证码不能重放');
    return verified.verificationId;
  }
  const proofA = await verify(a!.token, '13800000001', true);
  const pure = (await (
    await request(
      '/api/developer/keys',
      a!.token,
      { name: '模拟自助 · 纯净版', tier: 'pure', verificationId: proofA },
      201,
    )
  ).json()) as { secret: string; key: ApiKeyView };
  await request(
    '/api/developer/keys',
    a!.token,
    { name: '重复消费', tier: 'pure', verificationId: proofA },
    400,
    '核验凭据不能重用',
  );
  const duplicateProof = await verify(b!.token, '+8613800000001');
  await request(
    '/api/developer/keys',
    b!.token,
    { name: '跨账号重复号码', tier: 'advanced', verificationId: duplicateProof },
    409,
    '同号跨账号跨版本只能一个 Key',
  );
  const proofB = await verify(b!.token, '13800000002');
  const advanced = (await (
    await request(
      '/api/developer/keys',
      b!.token,
      { name: '模拟自助 · 高级版', tier: 'advanced', verificationId: proofB },
      201,
    )
  ).json()) as { secret: string; key: ApiKeyView };
  access.keys = [pure, advanced];
  writeFileSync(accessPath, JSON.stringify(access, null, 2));
  const callIds: string[] = [];
  for (const issued of [pure, advanced]) {
    const firstMessages = [{ role: 'user', content: '我想整理书桌，应该从哪里开始？' }];
    const first = await request('/v1/chat/completions', issued.secret, {
      model: 'gemini-rehearsal',
      messages: firstMessages,
    });
    callIds.push(first.headers.get('x-request-id')!);
    const firstBody = (await first.json()) as {
      choices: { message: { role: string; content: string } }[];
    };
    const second = await request('/v1/chat/completions/', issued.secret, {
      model: 'gemini-rehearsal',
      messages: [
        ...firstMessages,
        firstBody.choices[0]!.message,
        { role: 'user', content: '接下来怎么做？' },
      ],
      stream: true,
    });
    callIds.push(second.headers.get('x-request-id')!);
    assert.ok((await second.text()).includes('[DONE]'));
    const chat = (await (
      await request(`/api/admin/api-gateway/conversations/${issued.key.id}`, access.adminToken)
    ).json()) as ApiChatPage;
    assert.deepEqual(
      chat.messages.map((m) => m.role),
      ['user', 'assistant', 'user', 'assistant'],
    );
    const transcript = await (
      await request(
        `/api/admin/api-gateway/records/export?keyId=${issued.key.id}&format=chat`,
        access.adminToken,
      )
    ).text();
    writeFileSync(join(archive, `${issued.key.tier}-chat.txt`), transcript);
    const quota = (await (
      await request('/api/developer/quota', issued.key.userId === a!.me.id ? a!.token : b!.token)
    ).json()) as ApiQuota;
    assert.equal(quota.used, 2);
    assert.equal(quota.remaining, quota.total - 2);
  }
  for (const id of callIds) {
    const detail = (await (
      await request(`/api/admin/api-gateway/calls/${id}`, access.adminToken)
    ).json()) as {
      userId: string;
      keyId: string;
      verifiedPhone: string;
      outputText: string;
      request: unknown;
    };
    const issued = [pure, advanced].find((key) => key.key.id === detail.keyId)!;
    assert.equal(detail.userId, issued.key.userId);
    assert.equal(detail.verifiedPhone, issued.key.verifiedPhone);
    assert.ok(detail.outputText.includes('模拟模型回复'));
    assert.ok(detail.request);
  }
  await request(
    '/api/admin/api-gateway/calls',
    a!.token,
    undefined,
    401,
    '普通用户不能读取管理员记录',
  );
  assert.equal(
    await (await request('/api/admin/api-gateway/export', access.adminToken)).text(),
    '',
  );
  const overview = (await (
    await request('/api/admin/api-gateway/overview', access.adminToken)
  ).json()) as { total: number; succeeded: number };
  assert.equal(overview.total, 4);
  assert.equal(overview.succeeded, 4);
  store.saveNow();
  const saved = JSON.parse(readFileSync(join(archive, 'state.json'), 'utf8'));
  assert.ok(saved.users[a!.me.id] && saved.users[b!.me.id]);
  const report = {
    result: 'PASS',
    completedAt: new Date().toISOString(),
    ...manifest,
    modelAndSms: 'simulated',
    accounts: 2,
    keys: 2,
    calls: 4,
    deletedRecords: 0,
    steps,
    callIds,
    keyIds: [pure.key.id, advanced.key.id],
  };
  writeFileSync(join(archive, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ result: 'PASS', ...manifest, calls: 4, accounts: 2, keys: 2 }));
}
if (resume < 0) {
  try {
    await run();
  } catch (error) {
    writeFileSync(
      join(archive, 'failure.json'),
      JSON.stringify({ message: (error as Error).message, ...manifest }, null, 2),
    );
    console.error((error as Error).message);
  }
} else console.log(JSON.stringify({ result: 'REOPENED_WITHOUT_NEW_CALLS', ...manifest }));
process.on('SIGINT', () => {
  store.saveNow();
  server.close();
  upstream.close();
  db.close();
  process.exit(0);
});
