import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const checks = [];
function pass(name) {
  checks.push(name);
  console.log(`PASS ${name}`);
}
const origin = 'http://localhost:3038';
function cookies(headers, base = '') {
  const jar = new Map(
    base
      .split('; ')
      .filter(Boolean)
      .map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]),
  );
  for (const raw of headers.getSetCookie()) {
    const p = raw.split(';')[0];
    jar.set(p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1));
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
}
async function req(path, cookie = '', body, method) {
  return fetch(`${origin}${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
  });
}
async function json(path, cookie = '', body, expected = 200) {
  const r = await req(path, cookie, body);
  const data = await r.json();
  assert.equal(r.status, expected, `${path}: ${JSON.stringify(data)}`);
  return data;
}
async function demo(key, old = '') {
  const r = await req('/api/demo-login', old, { account: key });
  assert.equal(r.status, 200);
  return cookies(r.headers);
}
async function forum(cookie, path = '/api/yelan-local/session-status', body, method) {
  const r = await fetch(`http://localhost:4567${path}`, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
  });
  return { r, cookie: cookies(r.headers, cookie) };
}
async function native(cookie, path, body, method = 'POST') {
  const auth = await forum(cookie, '/api/config');
  const cfg = await auth.r.json();
  const r = await fetch(`http://localhost:4567/api/v3${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: auth.cookie,
      'x-csrf-token': cfg.csrf_token,
    },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  const data = await r.json();
  assert.equal(r.status, 200, `${path}: ${JSON.stringify(data)}`);
  return data.response;
}
const readyDeadline = Date.now() + 20000;
while (true) {
  try {
    if ((await json('/api/health')).forum) break;
  } catch {}
  if (Date.now() > readyDeadline) throw new Error('Community services are not ready');
  await new Promise((resolve) => setTimeout(resolve, 250));
}
assert.equal((await req('/api/private/manage')).status, 401);
pass('Anonymous management access denied');
let alice = await demo('a');
let bob = await demo('b');
const admin = await demo('admin');
const moderator = await demo('moderator');
assert.equal((await req('/api/private/manage', alice)).status, 403);
pass('Members cannot read management data');
const af = await forum(alice);
const astatus = await af.r.json();
assert(astatus.uid > 0);
pass('Direct forum entry uses the authoritative community session');
const switchCookie = await demo('b', alice);
assert.equal((await req('/api/private/me', alice)).status, 401);
const switched = await forum(
  `${switchCookie}; ${af.cookie
    .split('; ')
    .filter((s) => !s.startsWith('yl_community_session='))
    .join('; ')}`,
);
assert.notEqual((await switched.r.json()).uid, astatus.uid);
pass('Account switch revokes old session and replaces forum identity');
const ticket = await json('/api/private/forum-session', switchCookie, {});
await json('/api/logout', switchCookie, {});
assert.equal((await req('/api/private/me', switchCookie)).status, 401);
assert.equal((await (await forum(switched.cookie)).r.json()).uid, 0);
assert.equal((await fetch(ticket.url, { redirect: 'manual' })).status, 401);
pass('Logout revokes both forum access and already-issued SSO tickets');
const register = await fetch('http://localhost:4567/register', { redirect: 'manual' });
assert.equal(register.status, 302);
assert(register.headers.get('location').startsWith(origin));
pass('Forum registration is consolidated into the community account flow');
const suffix = randomUUID().slice(0, 8);
const password = `LocalTest${randomUUID()}9`;
const email = `test-${suffix}@community.example.test`;
const signup = await req('/api/register', '', {
  email,
  password,
  name: `验收作者${suffix}`,
  consent: true,
  role: 'admin',
});
assert.equal(signup.status, 201);
let author = cookies(signup.headers);
const me = await json('/api/private/me', author);
assert.equal(me.role, 'member');
pass('Registration cannot assign administrative privileges');
await json('/api/private/profile', author, { name: `资源作者${suffix}` });
const pf = await forum(author, '/api/config');
assert.equal((await pf.r.json()).loggedIn, true);
pass('Registered accounts can sign in to the forum without separate credentials');
const form = {
  type: 'character',
  title: `回归角色 ${suffix}`,
  subtitle: '审核、安装与版本更新验收',
  description: '这是本地验收创建的原创角色，用于验证社区资源管理的完整链路。',
  tags: ['本地验收'],
  version: '1.0.0',
  consent: true,
  payload: {
    name: `初版角色${suffix}`,
    consent: true,
    makePublic: false,
    worldbook: { background: '初始设定，请保留用户已有的副本。' },
  },
};
const draft = await json('/api/private/resources', author, form, 201);
const id = draft.id;
assert.equal((await req(`/api/private/install/${id}`, author, {})).status, 404);
assert(!(await json('/api/resources')).resources.some((r) => r.id === id));
pass('Draft resources are neither public nor installable');
assert.equal(
  (await req(`/api/private/resources/${id}/submit`, bob, { version: '1.0.0' })).status,
  403,
);
pass('Other users cannot submit or modify an owner resource');
await json(`/api/private/resources/${id}/submit`, author, { version: '1.0.0' });
assert.equal(
  (await req(`/api/private/review/${id}`, author, { version: '1.0.0', decision: 'approve' }))
    .status,
  403,
);
pass('Members cannot approve resources');
let published = await json(`/api/private/review/${id}`, moderator, {
  version: '1.0.0',
  decision: 'approve',
});
assert.equal(published.status, 'published', JSON.stringify(published));
assert(published.jobs.every((j) => j.status === 'done'));
pass('Moderator approval creates a real linked forum topic before publishing');
const publicV1 = (await json('/api/resources')).resources.find((r) => r.id === id);
assert(publicV1?.tid > 0);
const install1 = await json(`/api/private/install/${id}`, author, {}, 201);
const repeat = await json(`/api/private/install/${id}`, author, {});
assert.equal(repeat.characterId, install1.characterId);
assert(
  !(await json('/api/private/library', bob)).characters.some((c) => c.id === install1.characterId),
);
pass('Published installations are idempotent and private to their owner');
const v2 = {
  ...form,
  version: '1.0.1',
  payload: {
    ...form.payload,
    name: `新版角色${suffix}`,
    worldbook: { background: '这是新版本，不应覆盖用户原来的设定。' },
  },
};
await json(`/api/private/resources/${id}/versions`, author, v2, 201);
await json(`/api/private/resources/${id}/submit`, author, { version: '1.0.1' });
assert.equal((await json('/api/resources')).resources.find((r) => r.id === id).version, '1.0.0');
pass('A pending update leaves the approved public version available');
await json(`/api/private/review/${id}`, moderator, { version: '1.0.1', decision: 'approve' });
const publicV2 = (await json('/api/resources')).resources.find((r) => r.id === id);
assert.equal(publicV2.version, '1.0.1');
assert.equal(publicV2.tid, publicV1.tid);
const install2 = await json(`/api/private/install/${id}`, author, {}, 201);
assert.notEqual(install1.characterId, install2.characterId);
const library = await json('/api/private/library', author);
assert.equal(
  library.characters.find((c) => c.id === install1.characterId).customPayload.name,
  form.payload.name,
);
pass('Version updates retain the topic and never overwrite installed private copies');
await json(
  `/api/private/reply/${id}`,
  moderator,
  { content: '验收：有其他用户回复后，作者仍可下架自己的资源。' },
  201,
);
await json(`/api/private/resources/${id}/offline`, author, {
  reason: '本地验收下架',
});
assert.equal((await req(`/api/private/install/${id}`, author, {})).status, 404);
assert(!(await json('/api/discussions')).topics.some((t) => t.tid === publicV1.tid));
assert(
  (await json('/api/private/library', author)).characters.some(
    (c) => c.id === install1.characterId,
  ),
);
pass(
  'Owner takedown hides a topic with replies and blocks installs while preserving private copies',
);
await json(`/api/private/review/${id}`, moderator, {
  version: '1.0.1',
  decision: 'republish',
  reason: '本地验收复核恢复',
});
assert.equal((await json('/api/resources')).resources.find((r) => r.id === id).tid, publicV1.tid);
pass('Review can restore a resource and its original topic');
await native(
  admin,
  `/posts/${(await json(`/api/resources/${id}/discussion`)).pid}`,
  { content: '论坛内修改后的资源主帖，必须重新经过资源审核。', title: form.title },
  'PUT',
);
assert.equal((await req(`/api/private/install/${id}`, author, {})).status, 404);
pass('Editing the native forum main post takes its resource offline for re-review');
const adminMe = await json('/api/private/me', admin);
assert.equal(
  (
    await req(`/api/private/manage/accounts/${adminMe.id}`, admin, {
      role: 'member',
      reason: '尝试自行降权',
    })
  ).status,
  403,
);
pass('Administrators cannot remove their own administrative access');
const authorForum = await forum(author);
const authorUid = (await authorForum.r.json()).uid;
await json(`/api/private/manage/accounts/${me.id}`, admin, {
  status: 'banned',
  reason: '本地验收封禁',
});
assert.equal((await req('/api/private/me', author)).status, 401);
assert.equal((await req('/api/login', '', { email, password })).status, 403);
const banned = await forum(authorForum.cookie);
assert.equal((await banned.r.json()).uid, 0);
pass('Bans revoke active sessions and block community and forum login');
await json(`/api/private/manage/accounts/${me.id}`, admin, {
  status: 'active',
  reason: '本地验收解除封禁',
});
const loginAgain = await req('/api/login', '', { email, password });
assert.equal(loginAgain.status, 200);
author = cookies(loginAgain.headers);
const unbanned = await forum(author);
assert.equal((await unbanned.r.json()).uid, authorUid);
pass('Unbanning restores the existing forum identity without creating another user');
const selfDraft = await json(
  '/api/private/resources',
  moderator,
  { ...form, title: `版主自审 ${suffix}` },
  201,
);
await json(`/api/private/resources/${selfDraft.id}/submit`, moderator, { version: '1.0.0' });
assert.equal(
  (
    await req(`/api/private/review/${selfDraft.id}`, moderator, {
      version: '1.0.0',
      decision: 'approve',
    })
  ).status,
  403,
);
pass('Moderators cannot approve their own submissions');
const audit = (await json('/api/private/manage', admin)).audit;
assert(audit.some((a) => a.action === 'account.manage' && a.target === me.id));
assert(audit.some((a) => a.action === 'resource.install' && a.target === id));
pass('Administrative decisions and resource installations have persisted audit records');
const nativeConfig = await forum(author, '/api/config');
const logoutConfig = await nativeConfig.r.json();
const nativeLogout = await fetch('http://localhost:4567/logout', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Cookie: nativeConfig.cookie,
    'x-csrf-token': logoutConfig.csrf_token,
  },
  body: '{}',
  redirect: 'manual',
});
assert.equal(nativeLogout.status, 200);
assert.equal((await req('/api/private/me', author)).status, 401);
pass('Logging out inside the native forum also revokes the community session');
await json(`/api/private/review/${selfDraft.id}`, admin, {
  version: '1.0.0',
  decision: 'reject',
  reason: '验收结束，保留驳回记录',
});
// Keep the normal community clean; retain recoverable rows as verification evidence.
await json(`/api/private/manage/accounts/${me.id}`, admin, {
  status: 'banned',
  reason: '验收结束，停用临时测试账号',
});
await json(`/api/private/review/${id}`, admin, {
  version: '1.0.1',
  decision: 'offline',
  reason: '验收结束，下架已封禁作者的验收资源',
});
assert(
  (await json('/api/private/manage', admin)).jobs
    .filter((j) => j.resourceId === id)
    .every((j) => j.status === 'done'),
);
assert(!(await json('/api/discussions')).topics.some((t) => t.tid === publicV1.tid));
pass('Managers can take down resources even after their creator is banned');
writeFileSync(
  resolve(import.meta.dirname, '../../.local/community-prototype/lifecycle-report.json'),
  JSON.stringify(
    { checkedAt: new Date().toISOString(), checks, resourceId: id, authorId: me.id },
    null,
    2,
  ),
);
console.log(`${checks.length} lifecycle checks passed.`);
