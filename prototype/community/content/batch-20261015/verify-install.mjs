import assert from 'node:assert/strict';
import {manifest,load,save,session,request,phone,content} from './client.mjs';
const state=load('import-state.json');const consumer=await session('a'),other=await session('b');const auth=await phone(consumer);
const report=load('install-report.json',{items:{},checks:[]});
const library=()=>request('/api/private/library',consumer);
const boot=()=>request('/api/phone/bootstrap','',undefined,{headers:auth});
const rules=async id=>(await request(`/api/phone/characters/${id}/rules`,'',undefined,{headers:auth})).rules;
const put=(id,value)=>request(`/api/phone/characters/${id}/rules`,'',value,{method:'PUT',headers:auth});
if(!load('consumer-before.json',null)){save('consumer-before.json',await library());save('other-before.json',await request('/api/private/library',other));}
const only=process.argv.includes('--pilot')?['c-observatory','w-star-ridge','t-porcelain']:null;
for(const item of manifest.items.filter(i=>i.type==='character'&&(!only||only.includes(i.key)))){
 const r=state.items[item.key];if(r?.status!=='published-synced')continue;
 const installed=await request(`/api/private/install/${r.resourceId}`,consumer,{});const lib=await library();const c=lib.characters.find(c=>c.id===installed.characterId);assert(c);assert.equal(c.visibility,'private');
 const want=content(item).payload;assert.equal(c.name,want.name);assert.deepEqual(c.customPayload.card,want.card);
 for(const k of ['background','corePrinciples','rules','forbiddenRules'])assert.equal(c.customPayload.worldbook[k],want.worldbook[k]);
 const b=(await boot()).characters.find(c=>c.id===installed.characterId);assert(b);assert(b.persona.includes(want.worldbook.background));assert(b.persona.includes(want.card.initialState.location));
 report.items[item.key]={resourceId:r.resourceId,version:item.version,characterId:c.id,installed:true,fieldReadback:true,phoneBootstrap:true};save('install-report.json',report);console.log('INSTALLED',item.key,c.id);
}
for(const item of manifest.items.filter(i=>i.type==='worldbook'&&(!only||only.includes(i.key)))){
 const r=state.items[item.key];if(r?.status!=='published-synced')continue;
 const paired=item.related[0]||'c-observatory';const target=report.items[paired]?.characterId;assert(target,'Install paired character first');
 const before=await rules(target);const installed=await request(`/api/private/install/${r.resourceId}`,consumer,{characterId:target});
 const expected=content(item).worldbook;assert.deepEqual(installed.asset.payload,expected);const read=await rules(target);
 for(const entry of expected.entries)assert(read.worldBook.some(e=>JSON.stringify(e)===JSON.stringify(entry)));
 for(const e of before.worldBook)assert(read.worldBook.some(x=>JSON.stringify(x)===JSON.stringify(e)));
 assert.equal(read.preset,before.preset);assert.deepEqual(read.regexes,before.regexes);
 assert((await library()).bindings.some(b=>b.assetId===installed.asset.id&&b.characterId===target));
 report.items[item.key]={resourceId:r.resourceId,version:item.version,assetId:installed.asset.id,characterId:target,installed:true,bound:true,entryCount:expected.entries.length,entriesReadback:true,preservedOriginalRules:true};save('install-report.json',report);console.log('BOUND',item.key,expected.entries.length);
}
for(const item of manifest.items.filter(i=>i.type==='theme'&&(!only||only.includes(i.key)))){
 const r=state.items[item.key];if(r?.status!=='published-synced')continue;
 const installed=await request(`/api/private/install/${r.resourceId}`,consumer,{});const b=await boot();assert.equal(b.communityTheme.installationId,installed.asset.id);assert.deepEqual(b.communityTheme.theme,content(item).theme);
 report.items[item.key]={resourceId:r.resourceId,version:item.version,assetId:installed.asset.id,installed:true,activeStateReadback:true,phoneBootstrap:true};save('install-report.json',report);console.log('THEME',item.key);
}
const c=report.items['c-observatory'],w=report.items['w-star-ridge'],t=report.items['t-porcelain'];
if(c&&w&&t){
 const n=(await library()).characters.length;const dup=await request(`/api/private/install/${c.resourceId}`,consumer,{});assert.equal(dup.characterId,c.characterId);assert(dup.alreadyInstalled);assert.equal((await library()).characters.length,n);
 const before=await rules(c.characterId);const wdup=await request(`/api/private/install/${w.resourceId}`,consumer,{characterId:c.characterId});assert(wdup.alreadyInstalled);assert.equal(wdup.asset.id,w.assetId);assert.deepEqual(await rules(c.characterId),before);
 const tdup=await request(`/api/private/install/${t.resourceId}`,consumer,{});assert(tdup.alreadyInstalled);assert.equal(tdup.asset.id,t.assetId);
 const manual={key:'验收手写词',content:'本批验收的用户自建条目，结束后恢复。',constant:false,useRegex:false,position:'after_char'};
 const changed=structuredClone(before);changed.preset+='\n本批验收用户预设';changed.regexes.push({name:'本批验收正则',pattern:'验收占位',replacement:'保留',target:'output',disabled:true});changed.worldBook[0].content+=' 用户手动补充：允许临时离开。';const edited=changed.worldBook[0];changed.worldBook.push(manual);
 try{await put(c.characterId,changed);await request(`/api/private/assets/${w.assetId}/unbind`,consumer,{characterId:c.characterId});const after=await rules(c.characterId);assert(after.worldBook.some(e=>JSON.stringify(e)===JSON.stringify(manual)));assert(after.worldBook.some(e=>JSON.stringify(e)===JSON.stringify(edited)));assert.equal(after.preset,changed.preset);assert.deepEqual(after.regexes,changed.regexes);}
 finally{await put(c.characterId,{...before,worldBook:before.worldBook.filter(e=>!content(manifest.items.find(i=>i.key==='w-star-ridge')).worldbook.entries.some(x=>JSON.stringify(x)===JSON.stringify(e)))});await request(`/api/private/assets/${w.assetId}/bind`,consumer,{characterId:c.characterId});assert.deepEqual(await rules(c.characterId),before);}
 const libB=await request('/api/private/library',other);assert(!libB.characters.some(x=>x.id===c.characterId));assert(!libB.assets.some(x=>[w.assetId,t.assetId].includes(x.id)));
 for(const [path,body] of [[`/api/private/assets/${w.assetId}/bind`,{characterId:c.characterId}],['/api/private/themes/activate',{id:t.assetId}]]){let denied=false;try{await request(path,other,body);}catch(e){assert.equal(e.status,404);denied=true;}assert(denied);}
 const authB=await phone(other);let denied=false;try{await request(`/api/phone/characters/${c.characterId}/rules`,'',undefined,{headers:authB});}catch(e){assert.equal(e.status,403);denied=true;}assert(denied);
 const pre=load('consumer-before.json');const now=await library();for(const old of pre.characters)assert.deepEqual(now.characters.find(x=>x.id===old.id),old);for(const old of pre.assets)assert.deepEqual(now.assets.find(x=>x.id===old.id),old);
 const bBefore=load('other-before.json');assert.deepEqual(libB,bBefore);
 report.checks=['same-version character/worldbook/theme installs reuse private identity','worldbook bind/unbind retains user additions, modified package entry, preset and regex','cross-account library hidden; asset writes 404; foreign phone role 403','pre-existing private characters and package snapshots unchanged','account B library and active theme unchanged'];
 save('prompt-input.json',(await boot()).characters.find(x=>x.id===c.characterId));
}
report.checkedAt=new Date().toISOString();save('install-report.json',report);
