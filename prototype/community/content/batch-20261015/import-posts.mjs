import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {dir,manifest,load,save,session,request,sleep} from './client.mjs';
const community=await session('admin');
const sso=await request('/api/private/forum-session',community,{path:'/category/5'});
const signed=await fetch(sso.url,{redirect:'manual',headers:{Cookie:community}});
assert.equal(signed.status,302);
let cookie=community+'; '+signed.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
let csrf='';
async function forum(path,body){
 const r=await fetch('http://localhost:4567'+path,{method:body===undefined?'GET':'POST',headers:{Cookie:cookie,'Content-Type':'application/json',...(csrf?{'x-csrf-token':csrf}:{}),Origin:'http://localhost:4567'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)});
 for(const raw of r.headers.getSetCookie()){const key=raw.split('=')[0]+'=';cookie=cookie.split('; ').filter(x=>!x.startsWith(key)).concat(raw.split(';')[0]).join('; ');}
 const j=await r.json();if(!r.ok){const e=new Error(`Forum ${r.status}: ${j.status?.message||JSON.stringify(j)}`);e.status=r.status;throw e;}return j;
}
const config=await forum('/api/config');assert(config.loggedIn);csrf=config.csrf_token;save('forum-admin.json',{cookie,csrf});
const state=load('posts-state.json',{items:{}});
async function findTitle(title){const found=[];for(let page=1;page<=20;page++){const c=await forum(`/api/category/5?page=${page}`);found.push(...c.topics.filter(t=>t.title===title&&!t.deleted));if(page>=c.pagination.pageCount)break;}assert(found.length<=1,'Duplicate title requires manual reconciliation');return found[0];}
for(const item of manifest.items.filter(i=>['tutorial','discussion'].includes(i.type))){
 let row=state.items[item.key]??={key:item.key,title:item.title,type:item.type,version:item.version,status:'not-started'};
 try{
  const text=readFileSync(resolve(dir,item.file),'utf8').replace(/^# .+\r?\n\r?\n/,'').trim();const hash=createHash('sha256').update(text).digest('hex');
  let existing=await findTitle(item.title);if(existing){row.tid=existing.tid;}
  if(!row.tid){
   row.status='submitting';save('posts-state.json',state);
   try{const created=await forum('/api/v3/topics',{cid:5,title:item.title,content:text});assert(!created.response?.queued,'Unexpected queued post: retain queue identity for moderator');row.tid=created.response.tid;row.pid=created.response.mainPid;save('posts-state.json',state);}
   catch(e){row.status='needs-query-before-retry';row.error=e.message;save('posts-state.json',state);throw e;}
   await sleep(2500);
  }
  const topic=await forum(`/api/topic/${row.tid}`);assert.equal(topic.title,item.title);assert(!topic.deleted);row.pid=topic.mainPid||topic.posts[0].pid;
  const raw=await forum(`/api/v3/posts/${row.pid}/raw`);assert.equal(raw.response.content.trim(),text,'Published forum source differs from file; edit deliberately, never duplicate');
  const anonymous=await(await fetch(`http://localhost:4567/api/topic/${row.tid}`)).json();assert.equal(anonymous.tid,row.tid);assert(!anonymous.deleted&&anonymous.posts.length);assert.equal(anonymous.posts[0].uid,config.uid);
  Object.assign(row,{status:'published-visible',contentSha256:hash,forumUrl:`http://localhost:4567/topic/${row.tid}`,authorUid:config.uid,checkedAt:new Date().toISOString(),workflow:'normal authenticated NodeBB Write API; existing administrator account; administrator posts are not queued'});delete row.error;save('posts-state.json',state);console.log('POSTED',item.key,row.tid);
 }catch(e){row.error=e.message;row.status='needs-retry';save('posts-state.json',state);console.error(item.key,e.message);process.exitCode=1;break;}
}
