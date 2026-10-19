import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const origin = 'http://localhost:3038';
const checks = [];
const record = (name) => {
  checks.push({ name, passed: true });
  console.log(`PASS ${name}`);
};
async function request(path, cookie = '', body, extra = {}) {
  return fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {}),
      ...extra,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    redirect: 'manual',
  });
}
async function login(account) {
  const response = await request('/api/demo-login', '', { account });
  assert.equal(response.status, 200);
  return response.headers.get('set-cookie').split(';')[0];
}
const health = await (await request('/api/health')).json();
assert.equal(health.forum, true);
record(`Real NodeBB ${health.version} is running`);
assert.equal((await request('/api/private/library')).status, 401);
record('Anonymous library access rejected');
assert.equal((await request('/api/private/install/night-archivist', '', {})).status, 401);
record('Anonymous install rejected');
const alice = await login('a');
const bob = await login('b');
assert.notEqual(alice, bob);
record('Independent Yelan account sessions');
const first = await (await request('/api/private/install/night-archivist', alice, {})).json();
const second = await (await request('/api/private/install/night-archivist', alice, {})).json();
assert.equal(first.characterId, second.characterId);
assert.equal(second.alreadyInstalled, true);
record('Repeated install is idempotent');
const libraryA = await (await request('/api/private/library', alice)).json();
const libraryB = await (await request('/api/private/library', bob)).json();
assert(
  libraryA.characters.some(
    (role) => role.id === first.characterId && role.visibility === 'private',
  ),
);
assert(!libraryB.characters.some((role) => role.id === first.characterId));
record('Private character is isolated between accounts A and B');
const themeResponse = await request('/api/private/install/quiet-moss', alice, {});
assert([200, 201].includes(themeResponse.status));
assert.equal((await themeResponse.json()).asset.type, 'theme');
record('Adapted theme is installed as a private account package');
assert.equal((await request('/api/private/install/missing', alice, {})).status, 404);
record('Unknown resource rejected');
assert.equal(
  (
    await request(
      '/api/private/install/night-archivist',
      alice,
      {},
      { Origin: 'https://untrusted.example' },
    )
  ).status,
  403,
);
record('Cross-origin write rejected');
const discussion = await (await request('/api/resources/night-archivist/discussion')).json();
assert(discussion.tid > 0 && discussion.posts.length > 0);
record('Resource discussion is read from NodeBB');
const like = await request(`/api/private/vote/${discussion.pid}`, alice, { enabled: true });
assert.equal(like.status, 200);
const sameLike = await request(`/api/private/vote/${discussion.pid}`, alice, { enabled: true });
assert.equal(sameLike.status, 200);
const voteStatus = await (
  await request(`/api/private/vote-status/${discussion.pid}`, alice)
).json();
assert.equal(voteStatus.upvoted, true);
record('NodeBB vote is idempotent and persisted');
const { url } = await (await request('/api/private/forum-session', alice, {})).json();
const sso = await fetch(url, { redirect: 'manual' });
assert.equal(sso.status, 302);
assert(sso.headers.get('set-cookie'));
record('One-time SSO ticket creates a NodeBB login session');
assert.equal((await fetch(url, { redirect: 'manual' })).status, 401);
record('SSO ticket replay rejected');
assert.equal(
  (
    await fetch('http://localhost:4567/api/yelan-local/vote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    })
  ).status,
  403,
);
record('Internal bridge operation requires bridge secret');
const report = { checkedAt: new Date().toISOString(), version: health.version, checks };
writeFileSync(
  resolve(import.meta.dirname, '../../.local/community-prototype/check-report.json'),
  JSON.stringify(report, null, 2),
);
console.log(`${checks.length} checks passed.`);
