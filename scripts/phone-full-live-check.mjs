import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
// Run from repository root with a dedicated local test account, never a real user's token.
const evidence='.server/phone-full-test';
fs.mkdirSync(evidence,{recursive:true});
const account=JSON.parse(fs.readFileSync(process.env.PHONE_TEST_ACCOUNT_FILE || `${evidence}/account.json`,'utf8'));
const base='http://127.0.0.1:3002/api/host';
const results=[];
async function req(name,path,{body,token=account.token,method}={}) {
  const start=Date.now();
  try {
    const r=await fetch(base+path,{method:method||(body?'POST':'GET'),headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(65000)});
    const bytes=Buffer.from(await r.arrayBuffer());
    let data;try{data=JSON.parse(bytes.toString())}catch{data={bytes:bytes.length,contentType:r.headers.get('content-type')}}
    results.push({name,status:r.status,ms:Date.now()-start,data});
    fs.writeFileSync(`${evidence}/live-results.json`,JSON.stringify(results,null,2));
    console.log(name,r.status,JSON.stringify(data).slice(0,350));
    if(r.headers.get('content-type')?.includes('audio'))fs.writeFileSync(`${evidence}/speech.ogg`,bytes);
    return data;
  }catch(e){results.push({name,error:e.message});fs.writeFileSync(`${evidence}/live-results.json`,JSON.stringify(results,null,2));console.log(name,e.message);return {};}
}
const boot=await req('bootstrap','/phone/bootstrap');
const id=boot.characters?.[0]?.id;
if(!id) process.exit(1);
await req('unauthenticated','/phone/bootstrap',{token:'invalid'});
await req('unknown character','/phone/characters/does-not-exist/rules');
await req('public rules readonly',`/phone/characters/${id}/rules`,{method:'PUT',body:{preset:'test'}});
await req('main model',`/phone/characters/${id}/chat/completions`,{body:{messages:[{role:'user',content:'这是功能测试，请只回答：测试成功。'}],max_tokens:80}});
await req('stream model',`/phone/characters/${id}/chat/completions`,{body:{messages:[{role:'user',content:'请只回答：你好。'}],stream:true,max_tokens:80}});
const event={eventId:randomUUID(),characterId:id,mode:'main',branchId:'story:full-test',sourceApp:'story',text:'测试剧情：用户与角色约定明天到星河桥交换紫色纸鹤，暗号为星砂七号。'};
await req('memory write','/phone/memory/events',{body:event});
await req('memory duplicate','/phone/memory/events',{body:event});
await req('memory conflict','/phone/memory/events',{body:{...event,text:'不同内容'}});
await req('branch memory',`/phone/memory?characterId=${id}&branchId=story:full-test`);
await req('main memory isolation',`/phone/memory?characterId=${id}`);
await req('speech',`/phone/characters/${id}/speech`,{body:{text:'你好，这是小手机语音测试。'}});
for(const kind of ['voice','voice-hq']){
 const session=await req(kind+' session','/phone/voice/sessions',{body:{characterId:id,kind}});
 if(!session.id)continue;
 let turn=await req(kind+' text',`/${kind}/sessions/${session.id}/turns/text`,{body:{text:'你好，请简短打个招呼。'}});
 const end=Date.now()+65000;
 while(turn.status==='processing'&&Date.now()<end){await new Promise(r=>setTimeout(r,2000));turn=await req(kind+' poll',`/${kind}/sessions/${session.id}/turns/${turn.id}`);}
 await req(kind+' close',`/${kind}/sessions/${session.id}/close`,{method:'POST'});
}
