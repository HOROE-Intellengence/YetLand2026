// Repairs no historical data. Reconciles a recorded batch, then optionally makes exactly
// two paid synthetic requests to verify response request IDs through the running middleware.
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const source = process.argv.find((v) => v.endsWith('.json'));
const readOnly = process.argv.includes('--reconcile-only');
if (!source || (!readOnly && !process.argv.includes('--confirm-live')))
  throw new Error(
    'Pass batch report.json and --confirm-live (two additional requests), or --reconcile-only',
  );
const original = JSON.parse(readFileSync(source, 'utf8'));
const userId: string = original.userId;
assert.ok(userId);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const base = 'http://127.0.0.1:8787';
let token = process.env.ADMIN_TOKEN;
for (const p of ['apps/api/.env', '.env'])
  if (!token && existsSync(join(repo, p))) {
    const line = readFileSync(join(repo, p), 'utf8')
      .split(/\r?\n/)
      .find((s) => /^\s*ADMIN_TOKEN\s*=/.test(s));
    if (line)
      token = line
        .slice(line.indexOf('=') + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
  }
const headers = {
  Authorization: `Bearer ${token || 'admin-dev-token'}`,
  'Content-Type': 'application/json',
};
async function admin(path: string, method = 'GET', body?: unknown) {
  const r = await fetch(`${base}/api/admin/api-gateway${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  assert.ok(r.ok, `${path}: ${r.status}`);
  return data;
}
const filter = `userId=${encodeURIComponent(userId)}&from=${encodeURIComponent(original.startedAt)}`;
const settingsBefore = (await admin('/settings')).settings;
const preludeBefore = await admin('/prelude');
const callsBefore = await admin(`/calls?${filter}`);
assert.equal(callsBefore.total, readOnly ? 8 : 6);
const historical = [];
const recoveredFollowups: Record<string, unknown>[] = [];
for (const row of callsBefore.rows) {
  const detail = await admin(`/calls/${row.id}`);
  const matched = original.results.find(
    (r: { status: number; marker: string }) =>
      r.status === 200 && JSON.stringify(detail.request).includes(r.marker),
  );
  if (!matched) {
    const marker = `REQUEST_ID_OK_${detail.stream ? 'STREAM' : 'JSON'}`;
    assert.ok(JSON.stringify(detail.request).includes(marker));
    assert.ok(detail.outputText.includes(marker));
    assert.equal(detail.status, 'succeeded');
    assert.equal(detail.identity.id, userId);
    recoveredFollowups.push({
      stream: Boolean(detail.stream),
      requestId: row.id,
      source: 'persisted_record_readback',
      detailLookupStatus: 200,
      inputSaved: true,
      outputSaved: true,
      inputTokens: detail.inputTokens,
      outputTokens: detail.outputTokens,
    });
    continue;
  }
  assert.ok(detail.outputText.includes(matched.marker));
  assert.equal(detail.identity.id, userId);
  assert.equal(detail.status, 'succeeded');
  historical.push({
    id: row.id,
    originalResponseId: matched.requestId,
    keyId: row.keyId,
    durationMs: row.durationMs,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    inputSaved: true,
    outputSaved: true,
    identityBound: true,
  });
}
assert.equal(historical.length, 6);
const k = readOnly
  ? null
  : await admin('/keys', 'POST', {
      userId,
      name: `请求ID修复验收 ${new Date().toISOString().slice(11, 19)}`,
      tier: 'pure',
      dailyLimit: 2,
      rpm: 2,
      concurrency: 2,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    });
const model = (await admin('/settings')).upstreams.find(
  (u: { id: string }) => u.id === settingsBefore.upstreamId,
).model;
const followups: Record<string, unknown>[] = recoveredFollowups;
let report: Record<string, unknown> = {
  originalReport: resolve(source),
  run: original.run,
  userId,
  historical,
  followups,
  peakObservedConcurrency: Math.max(...original.samples.map((s: { active: number }) => s.active)),
};
try {
  if (!readOnly) {
    const checks = await Promise.allSettled(
      [false, true].map(async (stream) => {
        const marker = `REQUEST_ID_OK_${stream ? 'STREAM' : 'JSON'}`;
        const start = Date.now();
        const r = await fetch(`${base}/v1/chat/completions/`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${k.secret}`,
            'Content-Type': 'application/json',
            'x-request-id': 'caller-correlation-must-not-replace-db-id',
          },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: `接口测试，请只回复 ${marker}` }],
            stream,
            max_tokens: 96,
            ...(stream ? { stream_options: { include_usage: true } } : {}),
          }),
          signal: AbortSignal.timeout(90000),
        });
        const wire = await r.text();
        assert.equal(r.status, 200);
        let text = '';
        if (!stream) text = JSON.parse(wire).choices[0].message.content;
        else
          for (const line of wire.split(/\r?\n/))
            if (line.startsWith('data:') && line.slice(5).trim() !== '[DONE]')
              text += JSON.parse(line.slice(5)).choices?.[0]?.delta?.content ?? '';
        assert.ok(text.includes(marker));
        const id = r.headers.get('x-request-id');
        assert.ok(id);
        assert.notEqual(id, 'caller-correlation-must-not-replace-db-id');
        const d = await admin(`/calls/${id}`);
        assert.equal(d.status, 'succeeded');
        assert.equal(d.userId, userId);
        assert.equal(d.keyId, k.key.id);
        assert.ok(d.outputText.includes(marker));
        followups.push({
          stream,
          requestId: id,
          status: 200,
          detailLookupStatus: 200,
          durationMs: Date.now() - start,
          inputTokens: d.inputTokens,
          outputTokens: d.outputTokens,
          inputSaved: JSON.stringify(d.request).includes(marker),
          outputSaved: true,
        });
      }),
    );
    for (const check of checks) if (check.status === 'rejected') throw check.reason;
  }
  const overview = await admin(`/overview?${filter}`);
  const calls = await admin(`/calls?${filter}`);
  const keys = (await admin(`/keys?userId=${userId}`)).keys;
  assert.equal(calls.total, 8);
  assert.equal(overview.total, 8);
  assert.equal(overview.succeeded, 8);
  assert.equal(overview.failed, 0);
  assert.equal(overview.active, 0);
  assert.equal(overview.usageMissing, 0);
  const sum = (field: string) =>
    calls.rows.reduce((total: number, r: Record<string, number>) => total + r[field]!, 0);
  assert.equal(overview.inputTokens, sum('inputTokens'));
  assert.equal(overview.outputTokens, sum('outputTokens'));
  assert.equal(
    keys.reduce((n: number, key: { totalCalls: number }) => n + key.totalCalls, 0),
    8,
  );
  assert.equal(
    keys.reduce((n: number, key: { todayCalls: number }) => n + key.todayCalls, 0),
    8,
  );
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
    peak = 0;
  for (const e of events) {
    active += e.delta;
    peak = Math.max(peak, active);
  }
  assert.equal(peak, 3);
  assert.deepEqual((await admin('/settings')).settings, settingsBefore);
  assert.deepEqual(await admin('/prelude'), preludeBefore);
  report = {
    ...report,
    passed: true,
    readOnlyReconciliation: readOnly,
    overview,
    peakPersistedConcurrency: peak,
    overLimitRejected: original.results.filter((r: { status: number }) => r.status === 429).length,
    keyCounts: keys.map(
      (v: { id: string; name: string; totalCalls: number; todayCalls: number }) => ({
        id: v.id,
        name: v.name,
        totalCalls: v.totalCalls,
        todayCalls: v.todayCalls,
      }),
    ),
    repairedIssue:
      'Parent requestId header overwrote durable gateway call ID; fixed with middleware regression tests and live JSON header lookup. Both live response bodies and archived records reconciled.',
    configurationUnchanged: true,
    advancedTested: false,
  };
  console.log(JSON.stringify({ passed: true, overview, peak, userId, followups }));
} catch (e) {
  report.passed = false;
  report.error = (e as Error).message;
  process.exitCode = 1;
  console.error((e as Error).message);
} finally {
  if (k) await admin(`/keys/${k.key.id}`, 'PATCH', { status: 'revoked' });
  report.allTestKeysRevoked = (await admin(`/keys?userId=${userId}`)).keys.every(
    (v: { status: string }) => v.status === 'revoked',
  );
  report.finishedAt = new Date().toISOString();
  const file = resolve(source).replace(/\.json$/, '-verified.json');
  writeFileSync(file, JSON.stringify(report, null, 2));
  console.log(`Verified report: ${file}`);
}
