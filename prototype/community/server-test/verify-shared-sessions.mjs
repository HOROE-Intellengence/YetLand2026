import fs from 'node:fs';import assert from 'node:assert/strict';
const dir='.local/community-prototype/account-integration';
const users=JSON.parse(fs.readFileSync(dir+'/accounts.json'));const gate=JSON.parse(fs.readFileSync('.local/community-prototype/server-test/server-sessions.json')).gate;
const main='https://yetland.cn',community='https://community.yetland.cn',forum='https://forum.community.yetland.cn';
const cookie=r=>r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
async function request(url,headers={},body){return fetch(url,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{Cookie:gate,'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});}
const uids=[];const checks=[];
for(const user of users){
  const begin=await request(community+'/account/start');assert.equal(begin.status,302);
  const challenge=new URL(begin.headers.get('location')).searchParams.get('community');
  const issue=await request(main+'/api/community-session',{Authorization:'Bearer '+user.token},{challenge});assert.equal(issue.status,200);
  const {url}=await issue.json();const complete=await request(url,{Cookie:gate+'; '+cookie(begin)});assert.equal(complete.status,302);
  const session=cookie(complete);assert.equal((await request(url,{Cookie:gate+'; '+cookie(begin)})).status,401);
  const me=await(await request(community+'/api/private/me',{Cookie:gate+'; '+session})).json();assert.equal(me.id,user.id);
  const link=await(await request(community+'/api/private/forum-session',{Cookie:gate+'; '+session},{})).json();
  const forumLogin=await request(link.url,{Cookie:gate+'; '+session});assert.equal(forumLogin.status,302);
  const forumCookie=cookie(forumLogin);const status=await(await request(forum+'/api/yelan-local/session-status',{Cookie:[gate,session,forumCookie].join('; ')})).json();assert.ok(status.uid>0);uids.push(status.uid);
  const launch=await(await request(community+'/api/private/phone-session',{Cookie:gate+'; '+session},{})).json();
  await request(community+'/api/logout',{Cookie:gate+'; '+session},{});
  assert.equal((await request(community+'/api/phone/bootstrap',{Authorization:'Bearer '+launch.token})).status,401);
}
assert.notEqual(uids[0],uids[1]);checks.push('production browser-bound main-to-community tickets consume once','A/B community-to-forum identities map to different forum UIDs','community logout invalidates the issued phone capability');
assert.equal((await fetch(community+'/api/resources',{redirect:'manual'})).status,401);
checks.push('community password gate remains required');fs.writeFileSync(dir+'/sessions-verification.json',JSON.stringify({checks,forumUids:uids},null,2));console.log(JSON.stringify({checks},null,2));
