import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { SubmissionSchema } from '../../../../apps/api/src/community-prototype/repository';
import { compileUserCharacter } from '../../../../packages/shared/src/contracts/user-character';
const dir = import.meta.dirname;
const manifest = JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8'));
const rows = [];
for (const item of manifest.items) {
 const text = readFileSync(resolve(dir, item.file), 'utf8');
 if (['character', 'worldbook', 'theme'].includes(item.type)) {
  const raw = JSON.parse(text);
  const parsed = SubmissionSchema.parse(raw);
  assert(Buffer.byteLength(JSON.stringify(raw),'utf8') <= 100000);
  assert.deepEqual(raw, parsed, `${item.key}: schema stripped or defaulted fields`);
  assert.deepEqual(Object.keys(raw).sort(), ['type','title','subtitle','description','tags','version','consent', {character:'payload',worldbook:'worldbook',theme:'theme'}[item.type]].sort());
  if (raw.type === 'character') {
   const compiled = compileUserCharacter(raw.payload);
   assert(compiled.profileSections.length >= 7);
   assert(!raw.payload.worldbook.notes && !raw.payload.voiceName && !raw.payload.hqVoiceProfileId);
  }
  if (raw.type === 'worldbook') assert.equal(raw.worldbook.entries.length,10);
  if (raw.type === 'theme') assert.equal(Object.keys(raw.theme.cssOverrides).length,20);
  rows.push({key:item.key,type:item.type,bytes:Buffer.byteLength(JSON.stringify(raw)),schema:'passed'});
 } else { assert(text.includes(item.title)); assert(text.length > 250); rows.push({key:item.key,type:item.type,bytes:Buffer.byteLength(text),format:'markdown forum body'}); }
}
assert.equal(rows.length,32);
const report={checkedAt:new Date().toISOString(),schemaSource:'current SubmissionSchema and referenced Zod contracts',items:rows};
writeFileSync(resolve(dir,'evidence/schema-validation.json'), JSON.stringify(report,null,2));
console.log(`Validated ${rows.length} items; largest request ${Math.max(...rows.filter(r=>r.schema).map(r=>r.bytes))} bytes.`);
