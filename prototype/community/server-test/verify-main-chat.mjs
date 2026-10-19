import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
const dir='.local/community-prototype/account-integration', file=dir+'/main-chat.json';
if(fs.existsSync(file)){console.log('Existing main-chat receipt retained; no duplicate model call.');process.exit(0);}
const [a,b]=JSON.parse(fs.readFileSync(dir+'/accounts.json'));const endpoint='https://yetland.cn';
const payload={characterId:a.characterId,sessionId:'sess_community_'+randomUUID().slice(0,8),round:1,prevStage:'daily',userBoundary:2,text:'许照，我第一次到观测站，今晚有点紧张。你平时在这里做什么？我们可以先从一件简单的小事开始吗？',history:[]};
const headers=user=>({'Content-Type':'application/json',Authorization:'Bearer '+user.token});
const denied=await fetch(endpoint+'/api/chat',{method:'POST',headers:headers(b),body:JSON.stringify(payload)});assert.equal(denied.status,400);
const start=Date.now();const r=await fetch(endpoint+'/api/chat',{method:'POST',headers:headers(a),body:JSON.stringify(payload),signal:AbortSignal.timeout(510000)});assert.equal(r.status,200);const raw=await r.text();fs.writeFileSync(dir+'/main-chat.sse',raw);
const events=raw.split('\n').filter(l=>l.startsWith('data:')).map(l=>JSON.parse(l.slice(5)));
assert.ok(events.some(e=>e.kind==='done'));assert.ok(!events.some(e=>e.kind==='error'||e.kind==='cutoff'));
const output=events.filter(e=>e.kind==='chunk').map(e=>e.text).join('');assert.ok(output.trim().length>5);
const history=await fetch(endpoint+'/api/sessions/'+payload.sessionId+'/messages',{headers:headers(a)});const messages=await history.json();assert.ok(messages.some(m=>m.role==='assistant'&&m.content));
assert.equal((await fetch(endpoint+'/api/sessions/'+payload.sessionId+'/messages',{headers:headers(b)})).status,404);
const report={at:new Date().toISOString(),userId:a.id,characterId:a.characterId,sessionId:payload.sessionId,model:events.find(e=>e.kind==='meta'),output,elapsedMs:Date.now()-start,done:true,persistedMessages:messages.length,crossAccountCharacterAndSessionDenied:true,worldbookScope:'Phone-only package not injected as global main-chat worldbook'};
fs.writeFileSync(file,JSON.stringify(report,null,2));console.log(JSON.stringify({model:report.model,replyCharacters:output.length,persistedMessages:messages.length,crossAccountDenied:true},null,2));
