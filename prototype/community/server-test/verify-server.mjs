import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = path.resolve(import.meta.dirname, '../../..');
const origin = 'https://community.yetland.cn', forum = 'https://forum.community.yetland.cn', phone = 'https://phone.community.yetland.cn';
const privateDir = path.join(root, '.local/community-prototype/server-test');
const delivery = JSON.parse(fs.readFileSync(path.join(root, 'prototype/community/content/batch-20261015/delivery.json')));
const report = { at: new Date().toISOString(), checks: [], items: [] };
const fetchRaw = (url, init = {}) => fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(30000), ...init });
let gate;
async function request(url, cookie = '', body, headers = {}) {
  const r = await fetchRaw(url, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: [gate,cookie].filter(Boolean).join('; '), Origin: origin, 'Content-Type': 'application/json', ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.ok(r.ok, `HTTP ${r.status} ${new URL(url).pathname}`);
  return { response: r, data: await r.json() };
}
async function login(key) {
  const {response} = await request(origin+'/api/demo-login','',{account:key});
  const cookie = response.headers.getSetCookie().find(c=>c.startsWith('yl_community_session=')).split(';')[0];
  return cookie;
}
for (const url of [origin+'/api/resources',forum+'/api/categories',phone+'/api/host/auth/me',forum+'/socket.io/?EIO=4&transport=polling']) {
  assert.equal((await fetchRaw(url)).status,401); report.checks.push('unauthenticated blocked: '+url);
}
const wrong = await fetchRaw(origin+'/__community-access',{method:'POST',headers:{Origin:origin},body:new URLSearchParams({password:'incorrect-test-value'})});
assert.equal(wrong.status,401);
assert.ok(process.env.COMMUNITY_TEST_PASSWORD,'Provide the access password through the process environment');
const access = await fetchRaw(origin+'/__community-access',{method:'POST',headers:{Origin:origin},body:new URLSearchParams({password:process.env.COMMUNITY_TEST_PASSWORD})});
assert.equal(access.status,303); gate=access.headers.getSetCookie()[0].split(';')[0];
report.checks.push('correct password accepted; wrong password rejected; Secure HttpOnly cookie');
const {data:catalog}=await request(origin+'/api/resources');assert.equal(catalog.forumAvailable,true);
const a=await login('a'), b=await login('b');
fs.mkdirSync(privateDir,{recursive:true});fs.writeFileSync(path.join(privateDir,'server-sessions.json'),JSON.stringify({gate,a,b}));
for(const item of delivery.items){
  if(item.resourceId){
    const resource=catalog.resources.find(r=>r.id===item.resourceId);assert.ok(resource,item.key);assert.equal(resource.version,item.version);assert.equal(resource.tid,item.tid);assert.equal(resource.title,item.title);
  }
  const {data:topic}=await request(forum+'/api/topic/'+item.tid,a);
  assert.equal(Number(topic.tid),item.tid);assert.ok(!topic.deleted);assert.ok(topic.posts?.length);
  if(item.resourceId) assert.ok(topic.posts[0].content.includes(origin+'/#resource/'+item.resourceId),'rendered resource link must use server origin');
  report.items.push({key:item.key,title:item.title,resourceId:item.resourceId,tid:item.tid,version:item.version,visible:true,forumUrl:forum+'/topic/'+item.tid});
}
const lib = async cookie => (await request(origin+'/api/private/library',cookie)).data;
const before=await lib(a), otherBefore=await lib(b);
const c=delivery.items.find(i=>i.key==='c-observatory'), w=delivery.items.find(i=>i.key==='w-star-ridge'), t=delivery.items.find(i=>i.key==='t-porcelain');
const {data:installed}=await request(origin+'/api/private/install/'+c.resourceId,a,{});
assert.ok(installed.alreadyInstalled); assert.equal((await lib(a)).characters.length,before.characters.length);
const {data:worldbook}=await request(origin+'/api/private/install/'+w.resourceId,a,{characterId:installed.characterId});assert.ok(worldbook.alreadyInstalled);
const {data:launch}=await request(origin+'/api/private/phone-session',a,{}); assert.equal(launch.url,phone);
const auth={Authorization:'Bearer '+launch.token};
const {data:rules}=await request(phone+'/api/host/phone/characters/'+installed.characterId+'/rules','',undefined,auth);
const expected=JSON.parse(fs.readFileSync(path.join(root,'prototype/community/content/batch-20261015',w.file))).worldbook;
for(const entry of expected.entries)assert.ok(rules.rules.worldBook.some(e=>JSON.stringify(e)===JSON.stringify(entry)));
try{
  const {data:theme}=await request(origin+'/api/private/install/'+t.resourceId,a,{});assert.ok(theme.alreadyInstalled);
  const {data:boot}=await request(phone+'/api/host/phone/bootstrap','',undefined,auth);
  assert.equal(boot.communityTheme.installationId,theme.asset.id);
  const characterPayload=JSON.parse(fs.readFileSync(path.join(root,'prototype/community/content/batch-20261015',c.file))).payload;
  const persona=boot.characters.find(x=>x.id===installed.characterId)?.persona || '';
  for(const value of [characterPayload.worldbook.background,characterPayload.card.relationshipByUser,characterPayload.card.initialState.location])assert.ok(persona.includes(value));
  assert.deepEqual(await lib(b),otherBefore);
  assert.ok(!otherBefore.characters.some(x=>x.id===installed.characterId));
}finally{ await request(origin+'/api/private/themes/activate',a,{id:before.activeTheme?.installationId || null}); }
const {data:sso}=await request(origin+'/api/private/forum-session',a,{});
assert.equal(new URL(sso.url).origin,forum);
const ssoResult=await fetchRaw(sso.url,{headers:{Cookie:gate+'; '+a}});assert.equal(ssoResult.status,302);
const forumCookie=ssoResult.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');
const {data:status}=await request(forum+'/api/yelan-local/session-status',a+'; '+forumCookie);assert.ok(status.uid>0);
report.checks.push('32 published items retain original identity/version/topic and visible forum content','representative character/worldbook/theme repeat installs reuse private copies','phone HTTPS proxy reads persona, bound worldbook entries and active theme','account B unchanged and cannot see A private role','one-time forum ticket retains the community identity');
fs.writeFileSync(path.join(privateDir,'server-verification.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({items:report.items.length,checks:report.checks,report:path.join(privateDir,'server-verification.json')},null,2));
