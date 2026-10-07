import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Hono } from 'hono';
import { GatewayDatabase, gatewayRoot, type Identity } from './database';
import { createGatewayRoute } from '../routes/api-gateway';
import { createAdminGatewayRoute } from '../routes/admin/api-gateway';
import { requireAdmin } from '../middleware/auth';
import { requestId } from '../middleware/request-id';
import { mockAuthRoute } from '../routes/auth';
import { changePhone, deleteAccount, resetPasswordViaOtp } from '../services/users';
import { store } from '../store/persistence';
import type { GatewayDependencies } from '../routes/api-gateway';
import { chatMessages } from './conversations';
import type { ApiChatPage } from '@yelan/shared';
import { ApiKeyApplicationSchema } from '@yelan/shared';

describe('public API gateway (isolated SQLite + controlled upstream)', () => {
  let dir: string, db: GatewayDatabase, app: Hono, deps: GatewayDependencies;
  let user: Identity;
  let sent: Record<string, unknown>[];
  let responder: (
    body: Record<string, unknown>,
    init?: RequestInit,
  ) => Response | Promise<Response>;
  const input = { name: 'test', tier: 'pure' as const, dailyLimit: 10, rpm: 10, concurrency: 2 };
  const body = {
    model: 'gemini-test',
    messages: [
      { role: 'system', content: 'client-system' },
      { role: 'user', content: 'hello' },
    ],
    temperature: 0.15,
    tools: [{ type: 'function', function: { name: 'ping' } }],
    extra_parameter: { a: true },
  };
  const range = () => ({ from: '2000-01-01T00:00:00.000Z', to: '2100-01-01T00:00:00.000Z' });
  const key = (tier: 'pure' | 'advanced' = 'pure') => db.createTestKey(user, { ...input, tier });
  const chat = (secret: string, value = body, path = '/v1/chat/completions') =>
    app.request(path, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(value),
    });
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'yl-gateway-'));
    db = new GatewayDatabase(dir, 'Initial expression rules');
    user = {
      id: 'account-one',
      name: 'Test User',
      email: 'user@example.test',
      phone: '13000000000',
      createdAt: new Date().toISOString(),
    };
    sent = [];
    responder = () =>
      Response.json({
        id: 'upstream-one',
        choices: [
          { message: { role: 'assistant', content: 'model reply' }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      });
    const fetcher = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      sent.push(b);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer upstream-private-key');
      return responder(b, init);
    });
    deps = {
      db: () => db,
      user: () => user,
      upstream: (id) => ({
        id,
        model: 'gemini-test',
        url: 'https://upstream.example/v1/chat/completions',
        key: 'upstream-private-key',
      }),
      fetcher: fetcher as typeof fetch,
    };
    app = new Hono();
    app.use('*', requestId());
    app.route('/v1', createGatewayRoute(deps));
  });
  afterEach(() => {
    vi.useRealTimers();
    db.close();
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  it('forwards pure requests without prompt/parameter changes and archives identity + real output', async () => {
    const k = key();
    const r = await chat(k.secret);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ id: 'upstream-one' });
    expect(sent).toEqual([body]);
    const row = db.call(r.headers.get('x-request-id')!)!;
    expect(row.outputText).toBe('model reply');
    expect(row.inputTokens).toBe(11);
    expect(row.status).toBe('succeeded');
    expect(JSON.parse(row.identity)).toMatchObject({ id: user.id, email: user.email });
    expect(row.trainingConsent).toBe(0);
    expect(db.key(k.key.id)?.verifiedPhone).toBeNull();
    expect(JSON.stringify(db.keys())).not.toContain(k.secret);
    expect(JSON.stringify(db.keys())).not.toContain('hash');
  });
  it('reports account quota across keys, retains failed/revoked usage and resets at UTC midnight', async () => {
    const first = key();
    const second = key('advanced');
    db.publish(0);
    await (await chat(first.secret)).text();
    responder = () => Response.json({ error: 'upstream unavailable' }, { status: 503 });
    await (await chat(second.secret)).text();
    db.patchKey(first.key.id, { status: 'revoked' });
    expect(db.quota(user.id)).toMatchObject({ total: 200, used: 2, remaining: 198 });
    expect(db.quota('other-account')).toMatchObject({ used: 0, remaining: 200 });
    db.setSettings({ ...db.settings(), accountDailyLimit: 1 });
    expect(db.quota(user.id)).toMatchObject({ total: 1, used: 2, remaining: 0 });
    const reset = db.quota(user.id).resetsAt;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(reset));
    expect(db.quota(user.id)).toMatchObject({ used: 0, remaining: 1 });
    expect(Date.parse(db.quota(user.id).resetsAt) - Date.parse(reset)).toBe(86400000);
  });
  it('requires a nonblank key name at both application and storage boundaries', () => {
    expect(
      ApiKeyApplicationSchema.safeParse({ tier: 'pure', verificationId: 'proof' }).success,
    ).toBe(false);
    expect(
      ApiKeyApplicationSchema.safeParse({ name: '  ', tier: 'pure', verificationId: 'proof' })
        .success,
    ).toBe(false);
    expect(() => db.createTestKey(user, { ...input, name: '  ' })).toThrow('名称');
    expect(db.createTestKey(user, { ...input, name: '  我的客户端  ' }).key.name).toBe(
      '我的客户端',
    );
  });
  it('enforces one verified-phone key across accounts and tiers, with atomic proof consumption', () => {
    const proof = (id: string, userId: string, phone: string) =>
      db.db
        .prepare('INSERT INTO phone_verifications VALUES (?,?,?,?,?,NULL)')
        .run(id, userId, phone, 'api_key', new Date().toISOString());
    const other = { ...user, id: 'different-account' };
    proof('p1', user.id, '13800000000');
    const first = db.createVerifiedKey(user, input, 'p1');
    expect(first.key).toMatchObject({
      verification: 'sms',
      verifiedPhone: '+8613800000000',
      name: 'test',
    });
    expect(() => db.createVerifiedKey(user, input, 'p1')).toThrow('核验');
    proof('p2', other.id, '+86 138-0000-0000');
    expect(() => db.createVerifiedKey(other, { ...input, tier: 'advanced' }, 'p2')).toThrow(
      '已有 Key',
    );
    db.patchKey(first.key.id, { status: 'disabled' });
    expect(() => db.createVerifiedKey(other, input, 'p2')).toThrow('已有 Key');
    db.db
      .prepare('UPDATE api_keys SET expiresAt=? WHERE id=?')
      .run('2000-01-01T00:00:00.000Z', first.key.id);
    expect(() => db.createVerifiedKey(other, input, 'p2')).toThrow('已有 Key');
    expect(
      db.db.prepare('SELECT consumedAt FROM phone_verifications WHERE id=?').get('p2'),
    ).toEqual({ consumedAt: null });
    db.patchKey(first.key.id, { status: 'revoked' });
    const replacement = db.createVerifiedKey(other, input, 'p2');
    expect(replacement.key.verifiedPhone).toBe(first.key.verifiedPhone);
    expect(db.key(first.key.id)?.status).toBe('revoked');
    const testKey = db.createTestKey(user, input);
    expect(() =>
      db.db
        .prepare('UPDATE api_keys SET verifiedPhone=? WHERE id=?')
        .run(replacement.key.verifiedPhone, testKey.key.id),
    ).toThrow(/UNIQUE/);
  });
  it('rejects missing, stale, cross-account and wrong-purpose SMS proof without creating keys', () => {
    expect(() => db.createVerifiedKey(user, input, '')).toThrow('验证');
    expect(() => db.createVerifiedKey(user, input, 'missing')).toThrow('核验');
    for (const [id, userId, purpose, verifiedAt] of [
      ['stale', user.id, 'api_key', new Date(Date.now() - 6 * 60000).toISOString()],
      ['other', 'someone-else', 'api_key', new Date().toISOString()],
      ['login', user.id, 'login', new Date().toISOString()],
    ]) {
      db.db
        .prepare('INSERT INTO phone_verifications VALUES (?,?,?,?,?,NULL)')
        .run(id, userId, '13900000000', purpose, verifiedAt);
      expect(() => db.createVerifiedKey(user, input, id!)).toThrow('核验');
    }
    expect(db.keys()).toHaveLength(0);
  });
  it('accepts blank storage variables from the shipped env template', () => {
    vi.stubEnv('API_GATEWAY_DATA_DIR', '');
    vi.stubEnv('YELAN_STATE_DIR', '');
    expect(gatewayRoot().replace(/\\/g, '/')).toMatch(/apps\/api\/\.local-test\/gateway$/);
  });
  it('supports trailing slash when mounted in the production-style parent router', async () => {
    expect((await chat(key().secret, body, '/v1/chat/completions/')).status).toBe(200);
  });
  it('returns the durable call ID even when a caller supplies x-request-id', async () => {
    const k = key();
    const response = await app.request('/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${k.secret}`,
        'Content-Type': 'application/json',
        'x-request-id': 'caller-supplied-id',
      },
      body: JSON.stringify(body),
    });
    await response.text();
    const id = response.headers.get('x-request-id')!;
    expect(id).not.toBe('caller-supplied-id');
    expect(db.call(id)).toMatchObject({ keyId: k.key.id, status: 'succeeded' });
  });
  it('requires real API keys and rejects account/admin/upstream tokens', async () => {
    for (const t of ['', 'admin-token', 'upstream-private-key', 'tok_account'])
      expect((await chat(t)).status).toBe(401);
    expect(sent).toHaveLength(0);
  });
  it('rejects expired, revoked, disabled, deleted-account and guest keys', async () => {
    const k = key();
    db.patchKey(k.key.id, { status: 'disabled' });
    expect((await chat(k.secret)).status).toBe(401);
    db.patchKey(k.key.id, { status: 'active' });
    user.isGuest = true;
    expect((await chat(k.secret)).status).toBe(401);
    user.isGuest = false;
    user.deletedAt = new Date().toISOString();
    expect((await chat(k.secret)).status).toBe(401);
    delete user.deletedAt;
    db.db.prepare('UPDATE api_keys SET expiresAt=?').run('2000-01-01');
    expect((await chat(k.secret)).status).toBe(401);
    db.db.prepare('UPDATE api_keys SET expiresAt=NULL').run();
    db.patchKey(k.key.id, { status: 'revoked' });
    expect((await chat(k.secret)).status).toBe(401);
    expect(() => db.patchKey(k.key.id, { status: 'active' })).toThrow('不能恢复');
    expect(sent).toHaveLength(0);
  });
  it('pins published advanced prelude while draft changes do not affect calls or pure keys', async () => {
    const advanced = key('advanced');
    const pure = key();
    expect((await chat(advanced.secret)).status).toBe(503);
    db.publish(0);
    db.saveDraft('A different unpublished draft', db.prelude().revision);
    const r = await chat(advanced.secret);
    await r.text();
    expect(sent[0]?.messages).toEqual([
      { role: 'system', content: 'Initial expression rules' },
      ...body.messages,
    ]);
    expect(db.call(r.headers.get('x-request-id')!)?.promptVersion).toBe(1);
    await chat(pure.secret);
    expect(sent[1]).toEqual(body);
  });
  it('conflicts stale drafts; rollback creates immutable new versions', () => {
    db.publish(0);
    const first = db.prelude().publishedId!;
    db.saveDraft('v2', 1);
    expect(() => db.saveDraft('stale', 1)).toThrow('草稿');
    db.publish(2);
    db.publish(3, first);
    expect(db.published()).toEqual({ id: 3, content: 'Initial expression rules' });
    expect(db.prelude().draft).toBe('v2');
  });
  it('allows at most two keys and does not reset account quota by replacing a key', async () => {
    db.setSettings({ ...db.settings(), accountDailyLimit: 1 });
    const a = key();
    key('advanced');
    expect(() => key()).toThrow('最多');
    await chat(a.secret);
    db.patchKey(a.key.id, { status: 'revoked' });
    const b = key();
    const r = await chat(b.secret);
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect(sent).toHaveLength(1);
  });
  it('enforces per-key request quotas and returns no pretend success', async () => {
    const k = key();
    db.patchKey(k.key.id, { dailyLimit: 1 });
    await chat(k.secret);
    expect((await chat(k.secret)).status).toBe(429);
    expect(db.overview(range()).total).toBe(1);
  });
  it('rejects undeclared model and disabled gateway before paid requests', async () => {
    const k = key();
    expect((await chat(k.secret, { ...body, model: 'other' })).status).toBe(404);
    db.setSettings({ ...db.settings(), enabled: false });
    expect((await chat(k.secret)).status).toBe(503);
    expect(sent).toHaveLength(0);
  });
  it('preserves SSE bytes including tools, usage, unicode and DONE; accumulates output', async () => {
    const wire =
      'data: {"choices":[{"index":0,"delta":{"content":"你好"}}]}\r\n\r\ndata: {"choices":[{"index":0,"delta":{"tool_calls":[{"id":"call-1"}]}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":9}}\n\ndata: [DONE]\n\n';
    const bytes = new TextEncoder().encode(wire);
    responder = () =>
      new Response(
        new ReadableStream({
          start(c) {
            for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
            c.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    const r = await chat(key().secret, { ...body, stream: true } as typeof body);
    expect(await r.text()).toBe(wire);
    const id = r.headers.get('x-request-id')!;
    expect(db.rawResponse(id)).toBe(wire);
    expect(db.call(id)).toMatchObject({
      status: 'succeeded',
      outputText: '你好',
      inputTokens: 20,
      outputTokens: 9,
    });
  });
  it('archives incomplete output and marks a missing DONE as interrupted', async () => {
    responder = () =>
      new Response('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      });
    const r = await chat(key().secret, { ...body, stream: true } as typeof body);
    await r.text();
    expect(db.call(r.headers.get('x-request-id')!)).toMatchObject({
      status: 'interrupted',
      outputText: 'partial',
      errorCode: 'UPSTREAM_TRUNCATED',
    });
  });
  it('does not retry or expose provider credentials on upstream failure', async () => {
    responder = () => new Response('failure upstream-private-key', { status: 401 });
    const r = await chat(key().secret);
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain('upstream-private-key');
    expect(sent).toHaveLength(1);
    expect(db.overview(range()).failed).toBe(1);
  });
  it('holds account concurrency across both tiers and releases it after stream cancellation', async () => {
    db.setSettings({ ...db.settings(), accountConcurrency: 1 });
    db.publish(0);
    const a = key();
    const b = key('advanced');
    responder = () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    const r = await chat(a.secret, { ...body, stream: true } as typeof body);
    expect((await chat(b.secret)).status).toBe(429);
    await r.body!.cancel();
    expect(db.overview(range()).active).toBe(0);
    expect(db.call(r.headers.get('x-request-id')!)?.errorCode).toBe('CLIENT_DISCONNECTED');
  });
  it('releases capacity on timeout even when the client stops consuming the stream', async () => {
    vi.useFakeTimers();
    db.setSettings({ ...db.settings(), timeoutSeconds: 10 });
    responder = () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode('data: {"choices":[]}\n\n'));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    const r = await chat(key().secret, { ...body, stream: true } as typeof body);
    await vi.advanceTimersByTimeAsync(10001);
    expect(db.call(r.headers.get('x-request-id')!)).toMatchObject({
      status: 'failed',
      errorCode: 'UPSTREAM_TIMEOUT',
    });
    expect(db.overview(range()).active).toBe(0);
    await expect(r.text()).rejects.toThrow();
  });
  it('does not make a paid upstream call if request persistence fails', async () => {
    const k = key();
    const failure = vi.spyOn(db, 'begin').mockImplementation(() => {
      throw new Error('disk full');
    });
    expect((await chat(k.secret)).status).toBe(500);
    expect(sent).toHaveLength(0);
    failure.mockRestore();
  });
  it('archives a failed response write without reporting success', async () => {
    const k = key();
    const failure = vi.spyOn(db, 'chunk').mockImplementation(() => {
      throw new Error('disk full');
    });
    const r = await chat(k.secret);
    expect(r.status).toBe(502);
    expect(db.call(r.headers.get('x-request-id')!)?.status).toBe('failed');
    failure.mockRestore();
  });
  it('rejects invalid and oversized input before calling upstream', async () => {
    const k = key();
    expect((await chat(k.secret, { ...body, messages: [] })).status).toBe(400);
    expect(
      (
        await chat(k.secret, {
          ...body,
          messages: [{ role: 'user', content: 'x'.repeat(2 * 1024 * 1024) }],
        })
      ).status,
    ).toBe(413);
    expect(sent).toHaveLength(0);
  });
  it('persists keys and marks unfinished calls interrupted on process restart', () => {
    const k = key();
    db.begin(db.key(k.key.id)!, {
      id: 'pending',
      request: '{}',
      upstreamRequest: '{}',
      model: 'gemini-test',
      upstreamId: 'test',
      stream: true,
      promptVersion: null,
    });
    db.close();
    db = new GatewayDatabase(dir, 'different');
    db.recover();
    expect(db.keyBySecret(k.secret)?.userId).toBe(user.id);
    expect(db.call('pending')?.status).toBe('interrupted');
    expect(db.prelude().draft).toBe('Initial expression rules');
  });
  it('admin endpoints require admin credentials; detail does not expose keys', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'test-admin-private');
    const admin = new Hono();
    admin.use('*', requireAdmin());
    admin.route('/gateway', createAdminGatewayRoute(deps));
    expect((await admin.request('/gateway/keys')).status).toBe(401);
    const k = key();
    const r = await chat(k.secret);
    await r.text();
    const detail = await admin.request(`/gateway/calls/${r.headers.get('x-request-id')}`, {
      headers: { Authorization: 'Bearer test-admin-private' },
    });
    const text = await detail.text();
    expect(detail.status).toBe(200);
    expect(text).toContain('user@example.test');
    expect(text).not.toContain(k.secret);
    expect(text).not.toContain('upstream-private-key');
    const exported = await admin.request('/gateway/export', {
      headers: { Authorization: 'Bearer test-admin-private' },
    });
    expect(await exported.text()).toBe('');
  });
  it('renders only new user messages and observed output without prompts, tools or repeated history', () => {
    const messages = chatMessages({
      id: 'turn',
      createdAt: new Date().toISOString(),
      outputText: 'new answer',
      request: JSON.stringify({
        messages: [
          { role: 'system', content: 'private prompt' },
          { role: 'user', content: 'old question' },
          { role: 'assistant', content: 'old answer' },
          { role: 'tool', content: 'private tool payload' },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'new question' },
              { type: 'image_url', image_url: { url: 'https://private.test/image' } },
            ],
          },
        ],
      }),
    });
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'new question\n[图片]'],
      ['assistant', 'new answer'],
    ]);
  });
  it('pages conversations within a key and exports chats separately from diagnostics and training', async () => {
    vi.stubEnv('ADMIN_TOKEN', 'test-admin-private');
    const admin = new Hono();
    admin.use('*', requireAdmin());
    admin.route('/gateway', createAdminGatewayRoute(deps));
    const k = key();
    const other = key();
    db.patchKey(k.key.id, { dailyLimit: 1000, rpm: 1000 });
    db.setSettings({ ...db.settings(), accountRpm: 1000 });
    for (let i = 0; i < 52; i++) {
      const id = `turn-${String(i).padStart(3, '0')}`;
      db.begin(db.key(k.key.id)!, {
        id,
        request: JSON.stringify({ messages: [{ role: 'user', content: `question ${i}` }] }),
        upstreamRequest: '{}',
        upstreamId: 'test',
        model: 'gemini-test',
        promptVersion: null,
        stream: false,
      });
      db.finish(id, {
        status: i === 51 ? 'failed' : 'succeeded',
        httpStatus: i === 51 ? 502 : 200,
        durationMs: 1,
        errorCode: i === 51 ? 'UPSTREAM_ERROR' : undefined,
        outputText: i === 51 ? '' : `answer ${i}`,
      });
    }
    db.patchKey(k.key.id, { status: 'revoked' });
    const headers = { Authorization: 'Bearer test-admin-private' };
    const path = `/gateway/conversations/${k.key.id}`;
    expect((await admin.request(path)).status).toBe(401);
    const first = await admin.request(path, { headers });
    expect(first.headers.get('cache-control')).toBe('no-store');
    const page = (await first.json()) as ApiChatPage;
    expect(page.messages[0]?.content).toBe('question 2');
    expect(page.messages.at(-1)?.content).toBe('question 51');
    expect(JSON.stringify(page)).not.toContain('UPSTREAM_ERROR');
    const older = (await (
      await admin.request(`${path}?before=${page.nextCursor}`, { headers })
    ).json()) as ApiChatPage;
    expect(older.messages.map((m: { content: string }) => m.content)).toEqual([
      'question 0',
      'answer 0',
      'question 1',
      'answer 1',
    ]);
    expect(older.nextCursor).toBeNull();
    expect(
      (
        await admin.request(`/gateway/conversations/${other.key.id}?before=${page.nextCursor}`, {
          headers,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        (await (
          await admin.request(`/gateway/conversations/${other.key.id}`, { headers })
        ).json()) as ApiChatPage
      ).messages,
    ).toEqual([]);
    const chatExport = await (
      await admin.request(`/gateway/records/export?keyId=${k.key.id}&format=chat`, { headers })
    ).text();
    expect(chatExport).toContain('用户：\nquestion 0');
    expect(chatExport).toContain('AI：\nanswer 50');
    expect(chatExport).not.toContain('UPSTREAM_ERROR');
    const records = await (
      await admin.request(`/gateway/records/export?keyId=${k.key.id}`, { headers })
    ).text();
    expect(records.trim().split('\n')).toHaveLength(52);
    expect(records).toContain('UPSTREAM_ERROR');
    expect(records).not.toContain(k.secret);
    expect(await (await admin.request('/gateway/export', { headers })).text()).toBe('');
  });
  it('fails closed on all mock OTP account takeover paths outside tests', async () => {
    vi.stubEnv('VITEST', '');
    for (const path of ['/otp', '/verify', '/password/reset'])
      expect(
        (
          await mockAuthRoute.request(path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          })
        ).status,
      ).toBe(503);
    await expect(resetPasswordViaOtp('13000000000', '123456', 'password123')).rejects.toThrow(
      '短信',
    );
    await expect(changePhone('some-user', '13000000000', '123456')).rejects.toThrow('短信');
    store.state().users['no-password-gateway-test'] = {
      id: 'no-password-gateway-test',
      token: 'fake',
      phone: '13000000000',
      ageVerified: true,
      narrativeBoundary: 2,
      ifUnlocked: false,
      createdAt: new Date().toISOString(),
      candle: 0,
      registerGrant: 0,
      conversationRounds: 0,
    };
    await expect(deleteAccount('no-password-gateway-test', { code: '123456' })).rejects.toThrow(
      '验证码',
    );
    delete store.state().users['no-password-gateway-test'];
  });
});
