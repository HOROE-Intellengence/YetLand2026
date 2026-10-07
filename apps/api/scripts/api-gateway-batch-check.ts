// Explicit live small-batch test against the running backend. Leaves labelled records;
// revokes its two test keys in finally. Does not publish prompts or change gateway limits.
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

if (!process.argv.includes('--confirm-live'))
  throw new Error('Requires --confirm-live (up to six paid synthetic requests)');
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const base = 'http://127.0.0.1:8787';
let adminToken = process.env.ADMIN_TOKEN;
for (const path of ['apps/api/.env', '.env']) {
  const file = join(repo, path);
  if (!adminToken && existsSync(file)) {
    const line = readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .find((l) => /^\s*ADMIN_TOKEN\s*=/.test(l));
    if (line)
      adminToken = line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
  }
}
const adminHeaders = {
  Authorization: `Bearer ${adminToken || 'admin-dev-token'}`,
  'Content-Type': 'application/json',
};
async function admin(path: string, method = 'GET', body?: unknown) {
  const response = await fetch(`${base}/api/admin/api-gateway${path}`, {
    method,
    headers: adminHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`Admin ${path}: ${response.status} ${result.code ?? ''}`);
  return result;
}
const run = new Date().toISOString().replace(/[:.]/g, '-');
const startedAt = new Date().toISOString();
const results: {
  wave: number;
  slot: number;
  stream: boolean;
  marker: string;
  keyId: string;
  status: number;
  requestId: string | null;
  startedMs: number;
  finishedMs: number;
  durationMs: number;
  validOutput: boolean;
  done: boolean;
  errorCode?: string;
  outputCharacters: number;
}[] = [];
const samples: { at: string; active: number; total: number; succeeded: number }[] = [];
const keys: { secret: string; key: { id: string; prefix: string } }[] = [];
let polling: ReturnType<typeof setInterval> | undefined;
let pollingBusy = false;
let userId = '';
let report: Record<string, unknown> = { run, startedAt, target: base, results, samples };
const settingsBefore = await admin('/settings');
const preludeBefore = await admin('/prelude');
const globalBefore = await admin('/overview');
assert.equal(settingsBefore.settings.enabled, true);
assert.equal(
  settingsBefore.settings.accountConcurrency,
  3,
  'This bounded test expects the existing 3-concurrent account limit',
);
const provider = settingsBefore.upstreams.find(
  (u: { id: string; ready: boolean }) => u.id === settingsBefore.settings.upstreamId && u.ready,
);
assert.ok(provider, 'No ready Gemini upstream');
try {
  const registration = await fetch(`${base}/api/auth/email/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: `api-batch-${run.toLowerCase()}@example.test`,
      password: `Qa-${randomBytes(24).toString('base64url')}`,
      name: `API并发验收 ${run.slice(11, 19)}`,
    }),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(registration.status, 200);
  userId = (await registration.json()).me.id;
  report.userId = userId;
  for (const name of ['A', 'B'])
    keys.push(
      await admin('/keys', 'POST', {
        userId,
        name: `并发验收 ${run} ${name}`,
        tier: 'pure',
        dailyLimit: 10,
        rpm: 20,
        concurrency: 2,
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      }),
    );
  const filter = `userId=${encodeURIComponent(userId)}&from=${encodeURIComponent(startedAt)}`;
  const sample = async () => {
    if (pollingBusy) return;
    pollingBusy = true;
    try {
      const o = await admin(`/overview?${filter}`);
      samples.push({
        at: new Date().toISOString(),
        active: o.active,
        total: o.total,
        succeeded: o.succeeded,
      });
    } finally {
      pollingBusy = false;
    }
  };
  polling = setInterval(() => {
    void sample().catch(() => {});
  }, 120);
  async function call(wave: number, slot: number) {
    const k = keys[slot < 2 ? 0 : 1]!;
    const stream = slot !== 0;
    const marker = `BATCH_${run}_W${wave}_${slot}`;
    const startedMs = Date.now();
    const response = await fetch(`${base}/v1/chat/completions/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${k.secret}` },
      body: JSON.stringify({
        model: provider.model,
        messages: [
          {
            role: 'user',
            content: `这是合成的接口并发测试。请以 ${marker} 开头，再用80个汉字介绍整理书桌的步骤。`,
          },
        ],
        stream,
        max_tokens: 256,
        ...(stream ? { stream_options: { include_usage: true } } : {}),
      }),
      signal: AbortSignal.timeout(90000),
    });
    const wire = await response.text();
    let output = '',
      errorCode: string | undefined;
    if (!response.ok) errorCode = JSON.parse(wire).error?.code;
    else if (!stream) output = JSON.parse(wire).choices?.[0]?.message?.content ?? '';
    else
      for (const line of wire.split(/\r?\n/))
        if (line.startsWith('data:') && line.slice(5).trim() !== '[DONE]') {
          try {
            output += JSON.parse(line.slice(5)).choices?.[0]?.delta?.content ?? '';
          } catch {
            /* final reconciliation fails malformed streams */
          }
        }
    const finishedMs = Date.now();
    const item = {
      wave,
      slot,
      stream,
      marker,
      keyId: k.key.id,
      status: response.status,
      requestId: response.headers.get('x-request-id'),
      startedMs,
      finishedMs,
      durationMs: finishedMs - startedMs,
      validOutput: output.includes(marker),
      done: !stream || wire.includes('[DONE]'),
      errorCode,
      outputCharacters: output.length,
    };
    results.push(item);
    console.log(JSON.stringify(item));
  }
  // Four simultaneous submissions: three should enter the account gate, one should get 429.
  await Promise.all([0, 1, 2, 3].map((slot) => call(1, slot)));
  assert.equal(results.filter((r) => r.status === 200).length, 3);
  assert.equal(results.filter((r) => r.status === 429 && r.errorCode === 'RATE_LIMITED').length, 1);
  await Promise.all([0, 1, 2].map((slot) => call(2, slot)));
  await sample();
  clearInterval(polling);
  polling = undefined;
  const successful = results.filter((r) => r.status === 200);
  assert.equal(successful.length, 6);
  assert.ok(successful.every((r) => r.validOutput && r.done));
  const overview = await admin(`/overview?${filter}`);
  const calls = await admin(`/calls?${filter}`);
  const listedKeys = (await admin(`/keys?userId=${encodeURIComponent(userId)}`)).keys;
  let inputTokens = 0,
    outputTokens = 0;
  const reconciled = [];
  for (const result of successful) {
    const detail = await admin(`/calls/${result.requestId}`);
    assert.equal(detail.keyId, result.keyId);
    assert.equal(detail.userId, userId);
    assert.equal(detail.identity.id, userId);
    assert.equal(detail.status, 'succeeded');
    assert.ok(JSON.stringify(detail.request).includes(result.marker));
    assert.ok(detail.outputText.includes(result.marker));
    assert.equal(detail.promptVersion, null);
    assert.ok(detail.inputTokens > 0 && detail.outputTokens > 0);
    inputTokens += detail.inputTokens;
    outputTokens += detail.outputTokens;
    reconciled.push({
      id: detail.id,
      keyId: detail.keyId,
      inputTokens: detail.inputTokens,
      outputTokens: detail.outputTokens,
      inputSaved: true,
      outputSaved: true,
      identityBound: true,
    });
  }
  assert.equal(calls.total, 6);
  assert.equal(overview.total, 6);
  assert.equal(overview.succeeded, 6);
  assert.equal(overview.failed, 0);
  assert.equal(overview.active, 0);
  assert.equal(overview.inputTokens, inputTokens);
  assert.equal(overview.outputTokens, outputTokens);
  assert.equal(
    listedKeys.reduce((n: number, k: { totalCalls: number }) => n + k.totalCalls, 0),
    6,
  );
  assert.equal(
    listedKeys.reduce((n: number, k: { todayCalls: number }) => n + k.todayCalls, 0),
    6,
  );
  const maxActive = Math.max(...samples.map((s) => s.active));
  assert.equal(maxActive, 3);
  // Independent overlap proof from server-created and server-finished persisted records.
  const events = calls.rows
    .flatMap((r: { createdAt: string; durationMs: number }) => [
      { t: Date.parse(r.createdAt), delta: 1 },
      { t: Date.parse(r.createdAt) + r.durationMs, delta: -1 },
    ])
    .sort(
      (a: { t: number; delta: number }, b: { t: number; delta: number }) =>
        a.t - b.t || a.delta - b.delta,
    );
  let active = 0,
    overlap = 0;
  for (const event of events) {
    active += event.delta;
    overlap = Math.max(overlap, active);
  }
  assert.equal(overlap, 3);
  assert.deepEqual((await admin('/settings')).settings, settingsBefore.settings);
  assert.deepEqual(await admin('/prelude'), preludeBefore);
  const globalAfter = await admin('/overview');
  report = {
    ...report,
    passed: true,
    maxObservedActive: maxActive,
    maxPersistedOverlap: overlap,
    overview,
    reconciled,
    keyCounts: listedKeys.map((k: { id: string; totalCalls: number; todayCalls: number }) => ({
      id: k.id,
      totalCalls: k.totalCalls,
      todayCalls: k.todayCalls,
    })),
    globalDelta: {
      total: globalAfter.total - globalBefore.total,
      succeeded: globalAfter.succeeded - globalBefore.succeeded,
      inputTokens: globalAfter.inputTokens - globalBefore.inputTokens,
      outputTokens: globalAfter.outputTokens - globalBefore.outputTokens,
    },
    configurationUnchanged: true,
    advancedNotTested: 'Prelude not published',
    statisticsUrl: `${base}/admin#api-overview`,
  };
  console.log(JSON.stringify({ passed: true, maxActive, overlap, overview, userId }));
} catch (e) {
  report.passed = false;
  report.error = (e as Error).message;
  process.exitCode = 1;
  console.error((e as Error).message);
} finally {
  if (polling) clearInterval(polling);
  const cleanup = [];
  for (const k of keys) {
    try {
      await admin(`/keys/${k.key.id}`, 'PATCH', { status: 'revoked' });
      cleanup.push({ keyId: k.key.id, revoked: true });
    } catch {
      cleanup.push({ keyId: k.key.id, revoked: false });
      process.exitCode = 1;
    }
  }
  report.cleanup = cleanup;
  report.finishedAt = new Date().toISOString();
  const directory = join(repo, '.server', 'api-gateway-checks');
  mkdirSync(directory, { recursive: true });
  const file = join(directory, `${run}.json`);
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`Report: ${file}`);
}
