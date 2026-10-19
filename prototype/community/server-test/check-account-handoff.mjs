import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const main='http://localhost:33887', community='http://localhost:33038';
const checks=[];
async function call(base,path,body,headers={}) { return fetch(base+path,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})}); }
const cookie=r=>r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
const signup=await call(main,'/api/auth/email/register',{email:`handoff-${randomUUID()}@example.test`,password:`Aa9!${randomUUID()}`,name:'账号链路验收'});
assert.equal(signup.status,200);const account=await signup.json();const auth={Authorization:`Bearer ${account.token}`};
assert.equal((await call(main,'/api/community-session',{challenge:'a'.repeat(64)})).status,401);
assert.equal((await call(community,'/api/demo-login',{account:'admin'})).status,403);
assert.equal((await call(community,'/api/register',{})).status,403);
checks.push('anonymous handoff and demo authentication denied');
async function start(){const r=await call(community,'/account/start');assert.equal(r.status,302);const challenge=new URL(r.headers.get('location')).searchParams.get('community');const issued=await call(main,'/api/community-session',{challenge},auth);assert.equal(issued.status,200);return{cookie:cookie(r),url:(await issued.json()).url};}
const mismatch=await start();assert.equal((await fetch(mismatch.url,{redirect:'manual'})).status,401);
assert.equal((await fetch(mismatch.url,{redirect:'manual',headers:{Cookie:mismatch.cookie}})).status,401);
checks.push('browser mismatch and replay denied');
const handoff=await start();const result=await fetch(handoff.url,{redirect:'manual',headers:{Cookie:handoff.cookie}});assert.equal(result.status,302);
const session=cookie(result);const me=await(await call(community,'/api/private/me',undefined,{Cookie:session})).json();assert.equal(me.id,account.me.id);
assert.equal((await fetch(handoff.url,{redirect:'manual',headers:{Cookie:handoff.cookie}})).status,401);
const launch=await(await call(community,'/api/private/phone-session',{}, {Cookie:session})).json();
const phoneAuth={Authorization:`Bearer ${launch.token}`};
assert.equal((await(await call(community,'/api/auth/me',undefined,phoneAuth)).json()).id,account.me.id);
assert.equal((await call(main,'/api/auth/me',undefined,phoneAuth)).status,401);
await call(community,'/api/logout',{}, {Cookie:session});
assert.equal((await call(community,'/api/phone/bootstrap',undefined,phoneAuth)).status,401);
checks.push('formal user ID retained; phone capability cannot authenticate main account; logout revokes phone');
console.log(JSON.stringify({passed:checks},null,2));
