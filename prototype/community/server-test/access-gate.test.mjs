import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
const path = resolve(import.meta.dirname, '../../../.local/community-prototype/server-test/gate-test.json');
mkdirSync(resolve(path, '..'), { recursive: true });
const password = randomBytes(20).toString('hex'), passwordSalt = randomBytes(16).toString('hex');
writeFileSync(path, JSON.stringify({ origin: 'https://community.test', hosts: ['community.test', 'forum.community.test', 'phone.community.test'], passwordSalt, passwordHash: scryptSync(password, passwordSalt, 64).toString('hex'), sessionSecret: randomBytes(32).toString('hex') }));
test('private gate: password, scoped session, API guard, CSRF, forgery and throttling', async () => {
  const child = spawn(process.execPath, [resolve(import.meta.dirname, 'access-gate.mjs')], { env: { ...process.env, COMMUNITY_GATE_CONFIG: path, PORT: '13042' }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((ok, no) => { child.stdout.once('data', ok); child.once('error', no); child.once('exit', c => no(new Error('gate exit ' + c))); });
  const request = (url, init = {}) => fetch('http://127.0.0.1:13042' + url, { redirect: 'manual', ...init, headers: { 'X-Forwarded-Host': 'community.test', ...init.headers } });
  try {
    assert.equal((await request('/check')).status, 303);
    assert.equal((await request('/check', { headers: { 'X-Forwarded-Uri': '/api/resources' } })).status, 401);
    assert.equal((await request('/check', { headers: { 'X-Forwarded-Uri': '/socket.io/' } })).status, 401);
    assert.equal((await request('/check?EIO=4&transport=polling', { headers: { 'X-Forwarded-Uri': '/socket.io/?EIO=4&transport=polling' } })).status, 401);
    assert.equal((await request('/check', { headers: { 'X-Forwarded-Host': 'evil.test' } })).status, 404);
    const login = (body, origin = 'https://community.test', ip = 'test') => request('/__community-access', { method: 'POST', headers: { Origin: origin, 'X-Forwarded-For': ip }, body: new URLSearchParams({ password: body }) });
    assert.equal((await login(password, 'https://evil.test')).status, 403);
    assert.equal((await login('wrong')).status, 401);
    const good = await login(password);
    assert.equal(good.status, 303);
    const set = good.headers.get('set-cookie');
    for (const flag of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Domain=community.test']) assert.ok(set.includes(flag));
    const session = set.split(';')[0];
    for (const host of ['community.test', 'forum.community.test', 'phone.community.test']) {
      assert.equal((await request('/check', { headers: { Cookie: session, 'X-Forwarded-Host': host } })).status, 204);
    }
    assert.equal((await request('/check', { headers: { Cookie: session + 'forged' } })).status, 303);
    for (let i = 0; i < 10; i++) assert.equal((await login('wrong', 'https://community.test', 'limited')).status, 401);
    assert.equal((await login(password, 'https://community.test', 'limited')).status, 429);
  } finally { child.kill(); }
});
