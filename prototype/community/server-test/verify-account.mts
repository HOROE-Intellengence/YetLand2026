import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as managedModule from '../../../ai-virtual-phone/lib/yelan-role-rules';
import * as promptModule from '../../../ai-virtual-phone/lib/llm-prompt-assembler';
const { buildManagedRoleSettings } = (managedModule as any).default || managedModule;
const { assemblePromptPayload } = (promptModule as any).default || promptModule;
const root=path.resolve(import.meta.dirname,'../../..');
const dir=path.join(root,'.local/community-prototype/account-integration'); fs.mkdirSync(dir,{recursive:true});
const main='https://yetland.cn', community='https://community.yetland.cn', phone='https://phone.community.yetland.cn';
const gate=JSON.parse(fs.readFileSync(path.join(root,'.local/community-prototype/server-test/server-sessions.json'),'utf8')).gate;
const priorReport=fs.existsSync(path.join(dir,'verification.json'))?JSON.parse(fs.readFileSync(path.join(dir,'verification.json'),'utf8')):{};
const report:any={at:new Date().toISOString(),checks:[],accounts:[],calls:priorReport.calls || []};
const save=()=>fs.writeFileSync(path.join(dir,'verification.json'),JSON.stringify(report,null,2));
async function request(base:string, endpoint:string, body?:unknown, extra:any={}, expected?:number){
  const r=await fetch(base+endpoint,{redirect:'manual',method:body===undefined?'GET':'POST',signal:AbortSignal.timeout(60000),headers:{Cookie:gate,Origin:base,'Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
  if(expected!==undefined)assert.equal(r.status,expected,`${endpoint}: ${r.status}`);return r;
}
async function json(base:string,endpoint:string,body?:unknown,extra:any={}){const r=await request(base,endpoint,body,extra);assert.ok(r.ok,`${endpoint}: ${r.status} ${await r.clone().text()}`);return r.json();}
const cookie=(r:Response)=>r.headers.getSetCookie().filter(x=>x.startsWith('yl_community_session=')).map(x=>x.split(';')[0]).join('; ');
let users:any;
const credentials=path.join(dir,'accounts.json');
if(fs.existsSync(credentials)) users=JSON.parse(fs.readFileSync(credentials,'utf8'));
else {users=['A','B'].map(label=>({label,email:`community-acceptance-${label.toLowerCase()}-${randomUUID().slice(0,8)}@example.test`,password:`Test9!${randomUUID()}`,name:`社区联调${label}`}));fs.writeFileSync(credentials,JSON.stringify(users,null,2));}
for(const user of users){
  const login=await request(main,'/api/auth/email/login',{email:user.email,password:user.password});
  const auth=login.ok?await login.json():await json(main,'/api/auth/email/register',{email:user.email,password:user.password,name:user.name});
  user.token=auth.token;user.id=auth.me.id;
  const r=await request(community,'/api/login',{email:user.email,password:user.password}, {},200);user.cookie=cookie(r);
  user.headers={Cookie:gate+'; '+user.cookie};user.auth={Authorization:`Bearer ${user.token}`};
  assert.equal((await json(community,'/api/private/me',undefined,user.headers)).id,user.id);
  const launch=await json(community,'/api/private/phone-session',{},user.headers);user.phoneToken=launch.token;user.phoneAuth={Authorization:`Bearer ${launch.token}`};
  assert.equal((await json(phone,'/api/host/auth/me',undefined,user.phoneAuth)).id,user.id);
  report.accounts.push({label:user.label,id:user.id});
}
fs.writeFileSync(credentials,JSON.stringify(users,null,2));
report.checks.push('A/B main account, community account, phone identity IDs match');save();
const delivery=JSON.parse(fs.readFileSync(path.join(root,'prototype/community/content/batch-20261015/delivery.json'),'utf8'));
const selected=['c-observatory','w-star-ridge','t-porcelain'].map(key=>delivery.items.find((i:any)=>i.key===key));
const catalog=await json(community,'/api/resources');
for(const item of delivery.items.filter((i:any)=>i.resourceId)){const r=catalog.resources.find((x:any)=>x.id===item.resourceId);assert.equal(r.version,item.version);assert.equal(r.tid,item.tid);}
for(const user of users){
  const installed=await json(community,'/api/private/install/'+selected[0].resourceId,{},user.headers);user.characterId=installed.characterId;
  const repeated=await json(community,'/api/private/install/'+selected[0].resourceId,{},user.headers);assert.equal(repeated.characterId,user.characterId);assert.equal(repeated.alreadyInstalled,true);
  const wb=await json(community,'/api/private/install/'+selected[1].resourceId,{characterId:user.characterId},user.headers);user.worldbookId=wb.asset.id;
  const theme=await json(community,'/api/private/install/'+selected[2].resourceId,{},user.headers);user.themeId=theme.asset.id;
  const library=await json(community,'/api/private/library',undefined,user.headers);
  assert.ok(library.installations.some((x:any)=>x.resourceId===selected[0].resourceId&&x.version===selected[0].version&&x.characterId===user.characterId));
  for(const [index,id] of [[1,user.worldbookId],[2,user.themeId]] as const){const asset=library.assets.find((x:any)=>x.id===id);assert.equal(asset.userId,user.id);assert.equal(asset.resourceId,selected[index].resourceId);assert.equal(asset.version,selected[index].version);}
  const mainCharacters=await json(main,'/api/characters',undefined,user.auth);assert.ok(mainCharacters.some((x:any)=>x.id===user.characterId));
  const boot=await json(phone,'/api/host/phone/bootstrap',undefined,user.phoneAuth);user.role=boot.characters.find((c:any)=>c.id===user.characterId);assert.ok(user.role.persona.includes('观测站南侧平台'));assert.equal(user.role.rules.worldBook.length,10);assert.equal(boot.communityTheme.installationId,user.themeId);
  report.accounts.find((a:any)=>a.id===user.id).binding={resourceId:selected[0].resourceId,version:selected[0].version,characterId:user.characterId,worldbookId:user.worldbookId,themeId:user.themeId};
}
fs.writeFileSync(credentials,JSON.stringify(users,null,2));
const [a,b]=users;assert.notEqual(a.characterId,b.characterId);assert.notEqual(a.worldbookId,b.worldbookId);assert.notEqual(a.themeId,b.themeId);
await request(main,'/api/characters/'+a.characterId,undefined,b.auth,404);
await request(phone,'/api/host/phone/characters/'+a.characterId+'/rules',undefined,b.phoneAuth,403);
await request(community,'/api/private/assets/'+a.worldbookId+'/bind',{characterId:b.characterId},b.headers,404);
await request(community,'/api/private/assets/'+b.worldbookId+'/bind',{characterId:a.characterId},b.headers,403);
await request(community,'/api/private/themes/activate',{id:a.themeId},b.headers,404);
const denied=await request(phone,'/api/host/phone/characters/'+a.characterId+'/chat/completions',{messages:[{role:'user',content:'unauthorized synthetic probe'}],stream:true},b.phoneAuth);assert.ok([403,404].includes(denied.status));
report.checks.push('public resource IDs retained; A/B get distinct private copies; repeat installs reuse own copy','cross-account character reads, worldbook binding, theme activation and model requests rejected');save();
// Preserve user-created and edited worldbook entries through unbinding.
const custom={key:'联调自定义',content:'这是用户自己添加的条目，解绑不能删除。',constant:false,useRegex:false,position:'after_char'};
const original=structuredClone(a.role.rules);const edited=structuredClone(original);edited.worldBook[2].content+=' 用户补充：本次先留在室内。';edited.worldBook.push(custom);
const update=await fetch(phone+'/api/host/phone/characters/'+a.characterId+'/rules',{method:'PUT',headers:{Cookie:gate,...a.phoneAuth,'Content-Type':'application/json'},body:JSON.stringify(edited)});assert.ok(update.ok);
await json(community,'/api/private/assets/'+a.worldbookId+'/unbind',{characterId:a.characterId},a.headers);
const after=await json(phone,'/api/host/phone/characters/'+a.characterId+'/rules',undefined,a.phoneAuth);assert.equal(after.rules.worldBook.length,2);assert.ok(after.rules.worldBook.some((e:any)=>e.content===custom.content));assert.ok(after.rules.worldBook.some((e:any)=>e.content===edited.worldBook[2].content));
const reset=await fetch(phone+'/api/host/phone/characters/'+a.characterId+'/rules',{method:'PUT',headers:{Cookie:gate,...a.phoneAuth,'Content-Type':'application/json'},body:JSON.stringify({...original,worldBook:[]})});assert.ok(reset.ok);
await json(community,'/api/private/assets/'+a.worldbookId+'/bind',{characterId:a.characterId},a.headers);
report.checks.push('unbind preserves both newly added and user-edited entries; synthetic test changes explicitly restored');save();
if(process.argv.includes('--model')){
  for(const [index,prompt] of ['我第一次来星台山。我想去折光镜台，先告诉我那儿有什么，我们到了先做什么？','如果云太厚看不见天空，我不想摸黑继续走，今晚还能怎么安排？'].entries()){
    if(report.calls[index]?.done) continue; // Keep successful paid-call receipts on reruns.
    const settings=buildManagedRoleSettings(a.role);
    const history=[...report.calls.flatMap((r:any,i:number)=>[{id:`u${i}`,role:'user',content:r.prompt,timestamp:new Date().toISOString()},{id:`a${i}`,role:'assistant',content:r.response,timestamp:new Date().toISOString()}]),{id:'current',role:'user',content:prompt,timestamp:new Date().toISOString()}];
    const assembled=assemblePromptPayload({character:{...a.role,createdAt:new Date().toISOString()},history,preset:settings.preset,worldBooks:[settings.worldBook],regexes:[settings.regex],timeAware:false} as any);
    const messages=Array.isArray(assembled)?assembled:assembled.messages;
    assert.ok(Array.isArray(messages));const serialized=JSON.stringify(messages);assert.ok(serialized.includes('两张固定凳'));assert.ok(serialized.includes('观察先于命名'));
    const started=Date.now();const response=await fetch(phone+'/api/host/phone/characters/'+a.characterId+'/chat/completions',{method:'POST',headers:{Cookie:gate,...a.phoneAuth,'Content-Type':'application/json','X-Yelan-Memory-Branch':'community-acceptance-20261015'},body:JSON.stringify({messages,stream:true,max_tokens:1200}),signal:AbortSignal.timeout(510000)});
    const raw=await response.text();fs.writeFileSync(path.join(dir,`model-${index+1}.sse`),raw);assert.equal(response.status,200);
    let output='',done=false,finish=null;for(const line of raw.split('\n')){if(!line.startsWith('data:'))continue;const text=line.slice(5).trim();if(text==='[DONE]'){done=true;continue;}let event;try{event=JSON.parse(text);}catch{continue;}assert.ok(!event.error,JSON.stringify(event.error));output+=event.choices?.[0]?.delta?.content||'';finish=event.choices?.[0]?.finish_reason||finish;}
    assert.ok(done&&output.trim().length>5,'Stream must finish with nonempty assistant content');
    report.calls.push({prompt,response:output,done,finishReason:finish,elapsedMs:Date.now()-started,promptWorldbookConfirmed:true});save();console.log(`Real model turn ${index+1} completed (${output.length} characters)`);
  }
}
console.log(JSON.stringify({checks:report.checks,modelTurns:report.calls.length,report:path.join(dir,'verification.json')},null,2));
