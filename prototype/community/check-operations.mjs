import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { writeFileSync } from 'node:fs';
const checks = [];
const origin = 'http://localhost:3038';
const suffix = randomUUID().slice(0, 8);
const pass = (name) => {
  checks.push(name);
  console.log(`PASS ${name}`);
};
function cookie(r, old = '') {
  const map = new Map(
    old
      .split('; ')
      .filter(Boolean)
      .map((s) => {
        const i = s.indexOf('=');
        return [s.slice(0, i), s.slice(i + 1)];
      }),
  );
  for (const raw of r.headers.getSetCookie()) {
    const s = raw.split(';')[0];
    const i = s.indexOf('=');
    map.set(s.slice(0, i), s.slice(i + 1));
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function req(path, auth = '', body) {
  return fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: auth },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
  });
}
async function json(path, auth = '', body, status = 200) {
  const r = await req(path, auth, body);
  const j = await r.json();
  assert.equal(r.status, status, `${path}: ${JSON.stringify(j)}`);
  return j;
}
async function demo(account) {
  const r = await req('/api/demo-login', '', { account });
  assert.equal(r.status, 200);
  return cookie(r);
}
async function native(auth, path, body, method = 'POST', status = 200) {
  let r = await fetch('http://localhost:4567/api/config', { headers: { Cookie: auth } });
  const cfg = await r.json();
  auth = cookie(r, auth);
  r = await fetch(`http://localhost:4567/api/v3${path}`, {
    method,
    headers: { Cookie: auth, 'Content-Type': 'application/json', 'x-csrf-token': cfg.csrf_token },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const j = await r.json();
  assert.equal(r.status, status, JSON.stringify(j));
  return j.response;
}
async function until(fn) {
  const end = Date.now() + 12000;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error('State did not converge');
}
await until(async () => {
  try {
    return (await json('/api/health')).forum;
  } catch {
    return false;
  }
});
const admin = await demo('admin'),
  mod = await demo('moderator');
const password = `LocalOps${randomUUID()}3`,
  email = `ops-${suffix}@community.example.test`;
const signed = await req('/api/register', '', {
  name: `运营验收${suffix}`,
  email,
  password,
  consent: true,
});
assert.equal(signed.status, 201);
let author = cookie(signed);
const me = await json('/api/private/me', author);
let sr = await fetch('http://localhost:4567/api/yelan-local/session-status', {
  headers: { Cookie: author },
});
const nativeUid = (await sr.json()).uid;
const queued = await native(
  author,
  '/topics',
  {
    cid: 5,
    title: `论坛转资源 ${suffix}`,
    content: '这是从论坛发布并进入审核队列的原创验收帖子。',
  },
  'POST',
  202,
);
assert(queued.queued && queued.id);
pass('New member forum topics enter the real moderation queue');
const { post: accepted } = await native(mod, `/posts/queue/${queued.id}`, {});
assert(accepted.tid > 0);
pass('Moderators can approve queued forum posts through native permissions');
const form = {
  type: 'character',
  title: `关联原帖 ${suffix}`,
  subtitle: '从帖子转成可应用资源',
  description: '这是由原创论坛帖子转成的角色卡，管理员审核后进入资源广场。',
  tags: ['运营验收'],
  version: '1.0.0',
  consent: true,
  payload: {
    name: `运营角色${suffix}`,
    consent: true,
    worldbook: { background: '原创角色，用于验证论坛与资源的双向关联。' },
  },
};
assert.equal(
  (await req('/api/private/resources', admin, { ...form, sourceTid: accepted.tid })).status,
  403,
);
pass('Users cannot attach resources to somebody else’s forum topic');
const draft = await json(
  '/api/private/resources',
  author,
  { ...form, sourceTid: accepted.tid },
  201,
);
await json(`/api/private/resources/${draft.id}/submit`, author, { version: '1.0.0' });
await json(`/api/private/review/${draft.id}`, mod, { version: '1.0.0', decision: 'approve' });
assert.equal(
  (await json('/api/resources')).resources.find((r) => r.id === draft.id).tid,
  accepted.tid,
);
pass('Approved resources reuse their source topic without duplicating it');
await native(admin, `/topics/${accepted.tid}/state`, {}, 'DELETE');
await until(async () => !(await json('/api/resources')).resources.some((r) => r.id === draft.id));
assert.equal((await req(`/api/private/install/${draft.id}`, author, {})).status, 404);
pass('Native topic deletion prevents resource installation');
await native(admin, `/users/${nativeUid}/ban`, { until: 0, reason: '验证论坛封禁同步' }, 'PUT');
await until(async () => (await req('/api/private/me', author)).status === 401);
pass('A native forum ban propagates to community account access');
await native(admin, `/users/${nativeUid}/ban`, {}, 'DELETE');
await until(async () => {
  const r = await req('/api/login', '', { email, password });
  if (r.status === 200) {
    author = cookie(r);
    return true;
  }
  return false;
});
pass('A native forum unban restores the same community account');
await json(`/api/private/manage/accounts/${me.id}`, admin, {
  role: 'admin',
  reason: '验证角色提升',
});
assert.equal((await req('/api/private/me', author)).status, 401);
let logged = await req('/api/login', '', { email, password });
author = cookie(logged);
assert.equal((await json('/api/private/me', author)).role, 'admin');
const adminPage = await fetch('http://localhost:4567/admin', {
  headers: { Cookie: author },
  redirect: 'manual',
});
assert.equal(adminPage.status, 200);
pass('Community administrator roles grant the corresponding forum admin access');
await json(`/api/private/manage/accounts/${me.id}`, admin, {
  role: 'member',
  reason: '验证角色撤销',
});
const stale = await fetch('http://localhost:4567/admin', {
  headers: { Cookie: author },
  redirect: 'manual',
});
assert([302, 401, 403].includes(stale.status));
pass('Demotion revokes existing elevated sessions');
logged = await req('/api/login', '', { email, password });
author = cookie(logged);
await json('/api/private/account/delete', author, { currentPassword: password });
assert.equal((await req('/api/login', '', { email, password })).status, 401);
pass('Account deletion invalidates both login and existing sessions');

const failDraft = await json(
  '/api/private/resources',
  admin,
  { ...form, title: `恢复验收 ${suffix}` },
  201,
);
await json(`/api/private/resources/${failDraft.id}/submit`, admin, { version: '1.0.0' });
const cancelDraft = await json(
  '/api/private/resources',
  admin,
  { ...form, title: `取消验收 ${suffix}` },
  201,
);
await json(`/api/private/resources/${cancelDraft.id}/submit`, admin, { version: '1.0.0' });
const compose = [
  'compose',
  '--env-file',
  resolve(import.meta.dirname, '../../.local/community-prototype/compose.env.local'),
  '-f',
  resolve(import.meta.dirname, 'compose.yml'),
];
try {
  assert.equal(
    spawnSync('docker', [...compose, 'stop', 'nodebb'], { windowsHide: true, stdio: 'ignore' })
      .status,
    0,
  );
  await json(`/api/private/review/${failDraft.id}`, mod, { version: '1.0.0', decision: 'approve' });
  await json(`/api/private/review/${cancelDraft.id}`, mod, {
    version: '1.0.0',
    decision: 'approve',
  });
  const state = await json('/api/private/manage', admin);
  const retryJob = state.jobs.find((j) => j.resourceId === failDraft.id);
  const cancelJob = state.jobs.find((j) => j.resourceId === cancelDraft.id);
  assert.equal(retryJob.status, 'pending');
  assert(retryJob.attempts > 0);
  assert(!(await json('/api/resources')).resources.some((r) => r.id === failDraft.id));
  pass('Forum outages retain a retryable job and cannot falsely publish a resource');
  await json(`/api/private/manage/jobs/${cancelJob.id}/cancel`, admin, {});
  assert.equal(
    (await json('/api/private/manage', admin)).jobs.find((j) => j.id === cancelJob.id).status,
    'cancelled',
  );
  pass('Managers can cancel an uncompleted publication without losing audit history');
  assert.equal(
    spawnSync('docker', [...compose, 'start', 'nodebb'], { windowsHide: true, stdio: 'ignore' })
      .status,
    0,
  );
  await until(async () => {
    try {
      return (await json('/api/health')).forum;
    } catch {
      return false;
    }
  });
  let current = (await json('/api/private/manage', admin)).jobs.find((j) => j.id === retryJob.id);
  if (current.status !== 'done')
    await json(`/api/private/manage/jobs/${retryJob.id}/retry`, admin, {});
  await until(async () =>
    (await json('/api/resources')).resources.some((r) => r.id === failDraft.id),
  );
  pass('Recovery or a manual retry completes the original job and publishes once');
  assert(!(await json('/api/resources')).resources.some((r) => r.id === cancelDraft.id));
  pass('Cancelled jobs remain unpublished after the forum restarts');
  await json(`/api/private/review/${failDraft.id}`, mod, {
    version: '1.0.0',
    decision: 'offline',
    reason: '运营验收结束，保留可恢复记录',
  });
} finally {
  spawnSync('docker', [...compose, 'start', 'nodebb'], { windowsHide: true, stdio: 'ignore' });
}
writeFileSync(
  resolve(import.meta.dirname, '../../.local/community-prototype/operations-report.json'),
  JSON.stringify({ checkedAt: new Date().toISOString(), checks }, null, 2),
);
console.log(`${checks.length} operations checks passed.`);
