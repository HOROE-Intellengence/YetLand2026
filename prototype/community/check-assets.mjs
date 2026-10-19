import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const base = 'http://localhost:3038';
const checks = [];
const pass = (s) => {
  checks.push(s);
  console.log(`PASS ${s}`);
};
async function req(path, cookie = '', body, extra = {}) {
  return fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...extra },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function json(path, cookie = '', body, expected = 200, extra = {}) {
  const r = await req(path, cookie, body, extra);
  const d = await r.json();
  assert.equal(r.status, expected, JSON.stringify(d));
  return d;
}
async function demo(account) {
  return (await req('/api/demo-login', '', { account })).headers.getSetCookie()[0].split(';')[0];
}
const moderator = await demo('moderator'),
  bob = await demo('b');
const suffix = randomUUID().slice(0, 8);
const sign = await req('/api/register', '', {
  email: `test-${suffix}@community.example.test`,
  password: `Test${randomUUID()}9`,
  name: `资源验收${suffix}`,
  consent: true,
});
assert.equal(sign.status, 201);
const owner = sign.headers.getSetCookie()[0].split(';')[0];
const role = (await json('/api/private/install/night-archivist', owner, {}, 201)).characterId;
const foreign = (await json('/api/private/install/night-archivist', bob, {})).characterId;
const fields = {
  subtitle: '世界书与主题真实应用验收',
  description: '用于验证资源安装、角色绑定、主题状态和用户隔离的原创验收内容。',
  tags: ['本地验收'],
  version: '1.0.0',
  consent: true,
};
const worldbook = {
  schema: 'yelan-worldbook',
  schemaVersion: 1,
  entries: [
    {
      key: '旧车站',
      content: `验收专属末班车${suffix}`,
      constant: false,
      useRegex: false,
      position: 'after_char',
    },
  ],
};
const theme = {
  schema: 'yelan-phone-theme',
  schemaVersion: 1,
  name: `苔绿${suffix}`,
  cssOverrides: {
    '--c-header-bg': '#f7f5ef',
    '--c-page-body-bg': '#e8eee5',
    '--c-text': '#26332c',
  },
  fontFamily: 'system',
};
assert.equal(
  (
    await req('/api/private/resources', owner, {
      ...fields,
      title: '错误主题包',
      type: 'theme',
      theme: { ...theme, globalCustomCSS: 'body{display:none}' },
    })
  ).status,
  400,
);
assert.equal(
  (
    await req('/api/private/resources', owner, {
      ...fields,
      title: '远程主题包',
      type: 'theme',
      theme: { ...theme, cssOverrides: { '--c-header-bg': 'url(https://example.com)' } },
    })
  ).status,
  400,
);
pass('Theme rejects executable CSS and remote URL values');
async function publish(type, pkg) {
  const d = await json(
    '/api/private/resources',
    owner,
    { ...fields, title: `资源适配验收 ${type} ${suffix}`, type, [type]: pkg },
    201,
  );
  await json(`/api/private/resources/${d.id}/submit`, owner, { version: '1.0.0' });
  await json(`/api/private/review/${d.id}`, moderator, { version: '1.0.0', decision: 'approve' });
  const until = Date.now() + 35000;
  while (!(await json('/api/resources')).resources.some((r) => r.id === d.id)) {
    assert(Date.now() < until, 'Publish did not finish');
    await new Promise((r) => setTimeout(r, 200));
  }
  return d.id;
}
const wid = await publish('worldbook', worldbook),
  tid = await publish('theme', theme);
assert.equal((await req(`/api/private/install/${wid}`, owner, {})).status, 400);
assert.equal(
  (await req(`/api/private/install/${wid}`, owner, { characterId: foreign })).status,
  403,
);
assert.equal((await json('/api/private/library', owner)).assets.length, 0);
pass('Worldbook requires an owned private role before creating an installation');
const installed = await json(`/api/private/install/${wid}`, owner, { characterId: role }, 201);
await json(`/api/private/install/${wid}`, owner, { characterId: role });
const session = await json('/api/private/phone-session', owner, {});
const auth = { Authorization: `Bearer ${session.token}` };
let boot = await json('/api/phone/bootstrap', '', undefined, 200, auth);
assert.equal(boot.characters.find((c) => c.id === role).rules.worldBook.length, 1);
assert.equal(
  boot.characters.find((c) => c.id === role).rules.worldBook[0].content,
  worldbook.entries[0].content,
);
pass('Worldbook reaches the real managed phone role rules without duplicate bindings');
assert.equal(
  (await req(`/api/private/assets/${installed.asset.id}/bind`, bob, { characterId: foreign }))
    .status,
  404,
);
assert(!(await json('/api/private/library', bob)).assets.some((a) => a.id === installed.asset.id));
pass('Private packages and role binding are isolated across accounts');
assert.equal((await req('/api/phone/bootstrap')).status, 401);
assert.equal((await req('/api/private/library', '', undefined, auth)).status, 401);
pass('Phone-only capability cannot access community management or private library');
const themeInstall = await json(`/api/private/install/${tid}`, owner, {}, 201);
boot = await json('/api/phone/bootstrap', '', undefined, 200, auth);
assert.equal(boot.communityTheme.installationId, themeInstall.asset.id);
assert.equal(boot.communityTheme.theme.cssOverrides['--c-header-bg'], '#f7f5ef');
const version2 = {
  ...fields,
  title: `资源适配验收 theme ${suffix}`,
  type: 'theme',
  version: '1.0.1',
  theme: { ...theme, name: '第二版', cssOverrides: { '--c-header-bg': '#eeeeee' } },
};
await json(`/api/private/resources/${tid}/versions`, owner, version2, 201);
await json(`/api/private/resources/${tid}/submit`, owner, { version: '1.0.1' });
await json(`/api/private/review/${tid}`, moderator, { version: '1.0.1', decision: 'approve' });
assert.equal(
  (await json('/api/phone/bootstrap', '', undefined, 200, auth)).communityTheme.theme.name,
  theme.name,
);
const second = await json(`/api/private/install/${tid}`, owner, {}, 201);
assert.notEqual(second.asset.id, themeInstall.asset.id);
await json('/api/private/themes/activate', owner, { id: themeInstall.asset.id });
assert.equal(
  (await json('/api/phone/bootstrap', '', undefined, 200, auth)).communityTheme.theme.name,
  theme.name,
);
pass('Theme snapshots survive publisher updates and allow explicit version rollback');
assert.equal(
  (await req('/api/private/themes/activate', bob, { id: themeInstall.asset.id })).status,
  404,
);
await json('/api/private/themes/activate', owner, { id: null });
assert.equal(
  (await json('/api/phone/bootstrap', '', undefined, 200, auth)).communityTheme.theme,
  null,
);
pass('Theme activation and restoration are account-scoped');
await json(
  `/api/private/resources/${wid}/versions`,
  owner,
  {
    ...fields,
    title: `资源适配验收 worldbook ${suffix}`,
    type: 'worldbook',
    version: '1.0.1',
    worldbook,
  },
  201,
);
await json(`/api/private/resources/${wid}/submit`, owner, { version: '1.0.1' });
await json(`/api/private/review/${wid}`, moderator, { version: '1.0.1', decision: 'approve' });
const worldDeadline = Date.now() + 35000;
while (
  !(await json('/api/resources')).resources.some((r) => r.id === wid && r.version === '1.0.1')
) {
  assert(Date.now() < worldDeadline);
  await new Promise((r) => setTimeout(r, 200));
}
const sameEntries = await json(`/api/private/install/${wid}`, owner, { characterId: role }, 201);
await json(`/api/private/assets/${installed.asset.id}/unbind`, owner, { characterId: role });
assert.equal(
  (await json('/api/phone/bootstrap', '', undefined, 200, auth)).characters.find(
    (c) => c.id === role,
  ).rules.worldBook.length,
  1,
);
await json(`/api/private/assets/${sameEntries.asset.id}/unbind`, owner, { characterId: role });
assert.equal(
  (await json('/api/phone/bootstrap', '', undefined, 200, auth)).characters.find(
    (c) => c.id === role,
  ).rules.worldBook.length,
  0,
);
await json(`/api/private/assets/${installed.asset.id}/bind`, owner, { characterId: role });
pass('Shared entries remain until the last bound package version is removed');
const editedRules = {
  preset: '保留用户原有预设',
  worldBook: [
    worldbook.entries[0],
    {
      key: '用户条目',
      content: '用户自己的世界设定',
      constant: true,
      useRegex: false,
      position: 'after_char',
    },
  ],
  regexes: [
    { name: '保留正则', pattern: 'abc', replacement: 'xyz', target: 'output', disabled: false },
  ],
};
assert.equal(
  (
    await fetch(`${base}/api/phone/characters/${role}/rules`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify(editedRules),
    })
  ).status,
  200,
);
await json(`/api/private/assets/${installed.asset.id}/unbind`, owner, { characterId: role });
const retained = (await json('/api/phone/bootstrap', '', undefined, 200, auth)).characters.find(
  (c) => c.id === role,
).rules;
assert.equal(retained.worldBook.length, 1);
assert.equal(retained.worldBook[0].content, '用户自己的世界设定');
assert.equal(retained.preset, editedRules.preset);
assert.deepEqual(retained.regexes, editedRules.regexes);
pass('Unbinding preserves user worldbook entries, presets, and regex rules');
await json(`/api/private/assets/${installed.asset.id}/bind`, owner, { characterId: role });
pass('Worldbook can be unbound and rebound using its installed private copy');
await json(`/api/private/review/${wid}`, moderator, {
  version: '1.0.0',
  decision: 'offline',
  reason: '验收结束下架',
});
await json(`/api/private/review/${tid}`, moderator, {
  version: '1.0.1',
  decision: 'offline',
  reason: '验收结束下架',
});
await json(`/api/private/assets/${installed.asset.id}/unbind`, owner, { characterId: role });
assert.equal((await req(`/api/private/install/${wid}`, owner, { characterId: role })).status, 404);
assert((await json('/api/private/library', owner)).assets.some((a) => a.id === installed.asset.id));
pass('Takedown blocks new installations while preserving private packages and unbinding');
await json('/api/logout', owner, {});
assert.equal((await req('/api/phone/bootstrap', '', undefined, auth)).status, 401);
pass('Unified logout revokes a launched phone session');
writeFileSync(
  resolve('.local/community-prototype/assets-report.json'),
  JSON.stringify({ passed: checks.length, checks }, null, 2),
);
console.log(`${checks.length} resource adapter checks passed.`);
