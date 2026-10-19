import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import {dir,root,manifest,load,save,session,request,content,sleep} from './client.mjs';
assert(existsSync(resolve(root,'.local/community-prototype/batch-20261015-backup.json')),'Run backup.mjs first');
assert(existsSync(resolve(dir,'evidence/schema-validation.json')),'Run validate.ts first');
const author=await session('admin'),reviewer=await session('moderator');
assert.notEqual((await request('/api/private/me',author)).id,(await request('/api/private/me',reviewer)).id);
const args=process.argv.slice(2);const pilot=args.includes('--pilot');const first=args.includes('--first-window');
const items=manifest.items.filter(i=>['character','worldbook','theme'].includes(i.type)).filter(i=>!pilot||['c-observatory','w-star-ridge','t-porcelain'].includes(i.key));
const state=load('import-state.json',{batch:manifest.batch,items:{},attempts:[]});
for(const item of items){
 let row=state.items[item.key]??={key:item.key,title:item.title,version:item.version,status:'not-started'};
 try {
  // Query author-owned revisions before every write; recover ambiguous creates by exact content.
  let owned=(await request('/api/private/resources',author)).resources;
  const data=content(item);
  const matches=owned.filter(r=>r.revisions.some(v=>v.data.title===data.title&&v.data.type===data.type));
  assert(matches.length<=1,`Ambiguous resource identity ${item.key}; manual reconciliation needed`);
  if(!row.resourceId&&matches.length)row.resourceId=matches[0].id;
  if(!row.resourceId){
   while(true){
    const sent=state.attempts.filter(t=>t.at>Date.now()-600100);
    if(sent.length>=12){if(first){console.log('First window complete; resume without --first-window after cooldown.');save('import-state.json',state);process.exit(0);}const remaining=sent[0].at+601000-Date.now();row.retryAt=new Date(Date.now()+remaining).toISOString();save('import-state.json',state);console.log(`Rate window: waiting ${Math.ceil(remaining/1000)}s before ${item.key}`);await sleep(Math.min(60000,remaining));continue;}
    state.attempts.push({at:Date.now(),key:item.key});save('import-state.json',state);
    try {const created=await request('/api/private/resources',author,data);row.resourceId=created.id;save('import-state.json',state);break;}
    catch(e){if(e.status===429){row.status='rate-wait';row.error=e.message;save('import-state.json',state);console.log('Server rate limit; wait 60s, same author, no bypass.');await sleep(60000);continue;}throw e;}
   }
   owned=(await request('/api/private/resources',author)).resources;
  }
  let r=owned.find(r=>r.id===row.resourceId);assert(r,'Recorded resource not owned by author');
  let v=r.revisions.find(v=>v.version===item.version);
  if(!v){await request(`/api/private/resources/${r.id}/versions`,author,data);r=(await request('/api/private/resources',author)).resources.find(x=>x.id===r.id);v=r.revisions.find(x=>x.version===item.version);}
  for(const k of Object.keys(data).filter(k=>k!=='consent'))assert.deepEqual(v.data[k],data[k],`${item.key}: remote ${k} differs; publish a new version`);
  if(v.status==='draft'){await request(`/api/private/resources/${r.id}/submit`,author,{version:item.version});v.status='pending';}
  if(v.status==='pending')await request(`/api/private/review/${r.id}`,reviewer,{version:item.version,decision:'approve',reason:'原创内容核对：类型字段、边界、用法与版本完整；由独立版主审核。'});
  const deadline=Date.now()+120000;
  while(true){
   const manage=await request('/api/private/manage',reviewer);const resource=manage.resources.find(x=>x.id===r.id);const jobs=manage.jobs.filter(x=>x.resourceId===r.id&&x.version===item.version&&x.action==='publish');
   if(jobs.some(j=>j.status==='failed'))throw new Error(`Forum sync failed: ${jobs.find(j=>j.status==='failed').error}`);
   if(resource.status==='published'&&resource.liveVersion===item.version&&jobs.some(j=>j.status==='done')){
    const pub=(await request('/api/resources')).resources.find(x=>x.id===r.id&&x.version===item.version);assert(pub);
    const forum=await request(`/api/resources/${r.id}/discussion`);assert.equal(forum.tid,resource.tid);assert(forum.posts.length&&forum.posts[0].html);
    Object.assign(row,{status:'published-synced',tid:resource.tid,resourceId:r.id,communityUrl:`http://localhost:3038/#resource/${r.id}`,forumUrl:`http://localhost:4567/topic/${resource.tid}`,syncJob:jobs.find(j=>j.status==='done').id,checkedAt:new Date().toISOString()});delete row.error;delete row.retryAt;break;
   }
   assert(Date.now()<deadline,'Sync still pending: resume to query state');await sleep(2500);
  }
  save('import-state.json',state);console.log(`PUBLISHED ${item.key}: ${row.resourceId} tid=${row.tid}`);
 }catch(e){row.status='needs-retry';row.error=e.message;row.lastFailureAt=new Date().toISOString();save('import-state.json',state);console.error(item.key,e.message);process.exitCode=1;break;}
}
