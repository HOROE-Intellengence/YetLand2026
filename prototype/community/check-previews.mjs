import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Local read-only acceptance: do not submit, install, publish, activate, or call models.
const origin = 'http://localhost:3038';
const local = resolve(import.meta.dirname, '../../.local/community-prototype');
const db = new DatabaseSync(resolve(local, 'installations.sqlite'), { readOnly: true });
const before = JSON.stringify({
  installs: db.prepare('SELECT * FROM installations ORDER BY user_id,resource_id,version').all(),
  assets: db.prepare('SELECT * FROM community_assets ORDER BY id').all(),
  themes: db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%theme%'")
    .all()
    .map(({ name }) => ({ name, rows: db.prepare(`SELECT * FROM "${name}"`).all() })),
});
const checks = [];
const record = (name) => {
  checks.push({ name, passed: true });
  console.log(`PASS ${name}`);
};
const { resources } = await (await fetch(`${origin}/api/resources`)).json();
assert(resources.length);
for (const r of resources) {
  const response = await fetch(`${origin}/api/resources/${encodeURIComponent(r.id)}/preview`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const preview = await response.json();
  assert.equal(preview.id, r.id);
  assert.equal(preview.version, r.version);
  if (r.type === 'character') {
    assert(preview.character?.name);
    assert.equal(preview.character.name, r.preview.name);
    assert.deepEqual(
      Object.keys(preview.character).sort(),
      [
        'name',
        'background',
        'location',
        'opening',
        'principles',
        'style',
        'boundaries',
        'relationshipByUser',
        'relationshipByChar',
      ].sort(),
    );
    assert(!('payload' in r));
  } else assert.equal(preview.character, null);
}
record(`${resources.length} published resources preview anonymously at their current version`);
assert.equal((await fetch(`${origin}/api/resources/missing-resource/preview`)).status, 404);
record('Unknown resources are not previewable');
const hidden = db.prepare("SELECT id FROM community_resources WHERE status!='published'").all();
for (const { id } of hidden)
  assert.equal(
    (await fetch(`${origin}/api/resources/${encodeURIComponent(id)}/preview`)).status,
    404,
  );
record(`${hidden.length} draft/offline resources remain inaccessible`);
const draft = db
  .prepare(
    `SELECT r.id,v.version FROM community_resources r JOIN community_revisions v
  ON v.resource_id=r.id WHERE r.status='published' AND v.status!='published' LIMIT 1`,
  )
  .get();
if (draft) {
  const preview = await (
    await fetch(`${origin}/api/resources/${draft.id}/preview?version=${draft.version}`)
  ).json();
  assert.equal(preview.version, resources.find((r) => r.id === draft.id).version);
  record('A version query cannot expose an unpublished revision');
}
const after = JSON.stringify({
  installs: db.prepare('SELECT * FROM installations ORDER BY user_id,resource_id,version').all(),
  assets: db.prepare('SELECT * FROM community_assets ORDER BY id').all(),
  themes: db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%theme%'")
    .all()
    .map(({ name }) => ({ name, rows: db.prepare(`SELECT * FROM "${name}"`).all() })),
});
assert.equal(after, before);
record('Preview leaves all existing installations, assets, and active themes unchanged');
db.close();
writeFileSync(
  resolve(local, 'preview-report.json'),
  JSON.stringify({ at: new Date().toISOString(), checks }, null, 2),
);
