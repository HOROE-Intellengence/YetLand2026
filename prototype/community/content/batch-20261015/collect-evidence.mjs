import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {dir,manifest,load,save,session,request,content} from './client.mjs';
const reviewer=await session('moderator');const admin=await session('admin');
const manage=await request('/api/private/manage',reviewer);const owned=(await request('/api/private/resources',admin)).resources;const publicly=(await request('/api/resources')).resources;
const proof=load('publication-evidence.json',{items:{}});const state=load('import-state.json');
for(const item of manifest.items.filter(i=>['character','worldbook','theme'].includes(i.type))){const rec=state.items[item.key];if(rec?.status!=='published-synced')continue;
 const r=manage.resources.find(x=>x.id===rec.resourceId);const p=publicly.find(x=>x.id===rec.resourceId);assert(r&&p&&r.tid===rec.tid&&r.liveVersion===item.version&&p.status==='published');
 const v=owned.find(x=>x.id===r.id).revisions.find(x=>x.version===item.version);const data=content(item);for(const k of Object.keys(data).filter(k=>k!=='consent'))assert.deepEqual(v.data[k],data[k]);
 const events=[...new Map([...(proof.items[item.key]?.audit||[]),...manage.audit.filter(e=>e.target===r.id)].map(e=>[e.id,e])).values()].sort((a,b)=>a.id-b.id);
 const approval=events.find(e=>e.action==='resource.approve');if(approval)assert.notEqual(approval.actorId,r.ownerId);
 const done=manage.jobs.find(j=>j.resourceId===r.id&&j.version===item.version&&j.action==='publish'&&j.status==='done');assert(done);
 const forum=await request(`/api/resources/${r.id}/discussion`);assert.equal(forum.tid,r.tid);assert(forum.posts.length);
 proof.items[item.key]={resourceId:r.id,ownerId:r.ownerId,reviewerId:approval?.actorId,version:item.version,tid:r.tid,pid:r.pid,syncJob:done.id,syncDone:true,publiclyVisible:true,contentMatchesFile:true,audit:events,checkedAt:new Date().toISOString()};
}
save('publication-evidence.json',proof);
// Public summary intentionally omits cookies, account details and raw operational receipts.
writeFileSync(resolve(dir,'evidence/publication-summary.json'),JSON.stringify({checkedAt:new Date().toISOString(),items:Object.entries(proof.items).map(([key,r])=>({key,resourceId:r.resourceId,version:r.version,tid:r.tid,published:r.publiclyVisible,synced:r.syncDone,contentMatchesFile:r.contentMatchesFile,independentReview:!!r.reviewerId,auditActions:r.audit.map(e=>e.action)}))},null,2));
console.log(`Collected durable publication evidence for ${Object.keys(proof.items).length} resources.`);
