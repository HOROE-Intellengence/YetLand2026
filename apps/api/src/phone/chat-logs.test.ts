import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {PhoneChatLogs} from './chat-logs';
import Database from 'better-sqlite3';
it('groups new sessions and reads their full chronological history without merging owners or deleting repeated inputs',()=>{
 const root=mkdtempSync(join(tmpdir(),'phone-threads-')),db=new PhoneChatLogs(root);
 try{
  for(let i=0;i<35;i++){db.start({id:`turn-${String(i).padStart(2,'0')}`,userId:'one',characterId:'role',model:'test',messages:[{role:'user',content:'再讲一次'}],trace:{sourceApp:'chat',sessionId:'session-a'}});db.db.prepare('UPDATE calls SET createdAt=? WHERE id=?').run(`2026-10-12T12:${String(i).padStart(2,'0')}:00.000Z`,`turn-${String(i).padStart(2,'0')}`);}
  db.start({id:'other',userId:'two',characterId:'role',model:'test',messages:[],trace:{sourceApp:'chat',sessionId:'session-a'}});
  expect(db.list(1,'one',{grouped:'true'}).total).toBe(1);expect(db.list(1,'one',{grouped:'true'}).items[0]?.groupSize).toBe(35);
  expect(db.thread('turn-00')?.items.map(r=>r.id)).toEqual(Array.from({length:30},(_,i)=>`turn-${String(i).padStart(2,'0')}`));
  expect(db.thread('turn-00',2)?.items).toHaveLength(5);expect(db.thread('turn-00')?.grouping).toBe('session');
  expect(db.list(1,'one',{q:'再讲一次'}).total).toBe(35);
 }finally{db.db.close();rmSync(root,{recursive:true,force:true});}
});
it('paginates phone calls with stable user filters',()=>{
 const root=mkdtempSync(join(tmpdir(),'phone-pages-'));const db=new PhoneChatLogs(root);
 try {
  for(let i=0;i<65;i++)db.start({id:`call-${i}`,userId:'one',characterId:'role',model:'test',messages:[]});
  db.start({id:'other',userId:'two',characterId:'role',model:'test',messages:[]});
  const pages=[1,2,3].map(page=>db.list(page,'one'));
  expect(pages.map(p=>p.items.length)).toEqual([30,30,5]);
  expect(pages.every(p=>p.total===65)).toBe(true);
  expect(new Set(pages.flatMap(p=>p.items.map(row=>(row as {id:string}).id))).size).toBe(65);
 }finally{db.db.close();rmSync(root,{recursive:true,force:true})}
});
it('summarizes only the latest user message and decoded streamed reply without shipping context', () => {
 const root=mkdtempSync(join(tmpdir(),'phone-previews-'));const logs=new PhoneChatLogs(root);
 try {
  logs.start({id:'preview',userId:'one',characterId:'role',model:'test',messages:[
   {role:'system',content:'private-system'}, {role:'user',content:'old-input'}, {role:'assistant',content:'old-reply'},
   {role:'user',content:[{type:'text',text:'本轮输入'}, {type:'image_url',image_url:{url:'https://private.example/image'}}]},
  ]});
  const stream=['第一段', '回复'.repeat(200)].map(content=>'data: '+JSON.stringify({choices:[{delta:{content}}]})+'\n\n').join('')+'data: [DONE]\n\n';
  logs.finish('preview','complete',300,200,null,stream,false);
  const row=logs.list(1).items[0]!;
  expect(row.inputPreview).toBe('本轮输入 〔图片附件〕');
  expect(row.outputPreview).toHaveLength(240);
  expect(row.outputPreview).toMatch(/^第一段回复/);
  expect(row).not.toHaveProperty('request'); expect(row).not.toHaveProperty('response');
  expect(JSON.stringify(row)).not.toMatch(/private-system|old-input|old-reply|private.example/);
 } finally { logs.db.close();rmSync(root,{recursive:true,force:true}); }
});
it('migrates old archives and lazily caches previews without rewriting original messages', () => {
 const root=mkdtempSync(join(tmpdir(),'phone-legacy-'));
 const old=new Database(join(root,'phone-chat.sqlite'));
 old.exec('CREATE TABLE calls(id TEXT PRIMARY KEY,userId TEXT,characterId TEXT,branchId TEXT,model TEXT,createdAt TEXT,status TEXT,elapsedMs INTEGER,upstreamStatus INTEGER,errorCode TEXT,request TEXT,response TEXT,truncated INTEGER DEFAULT 0)');
 const request=JSON.stringify([{role:'user',content:'旧库输入'}]);
 old.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run('old','one','role','','test','2026-10-01','complete',100,200,null,request,'旧库回复',0);
 old.close();
 const logs=new PhoneChatLogs(root);
 try {
  expect(logs.list(1).items[0]).toMatchObject({inputPreview:'旧库输入',outputPreview:'旧库回复'});
  expect(logs.get('old')).toMatchObject({request,response:'旧库回复'});
  expect(logs.db.prepare('SELECT inputPreview FROM calls WHERE id=?').get('old')).toEqual({inputPreview:'旧库输入'});
 } finally {logs.db.close();rmSync(root,{recursive:true,force:true});}
});
it('combines exact user, character, branch and status filters with stable pagination', () => {
 const root=mkdtempSync(join(tmpdir(),'phone-scope-'));const logs=new PhoneChatLogs(root);
 try {
  for(let i=0;i<35;i++){logs.start({id:`scope-${String(i).padStart(2,'0')}`,userId:'one',characterId:'role',branchId:'main-branch',model:'test',messages:[]});logs.finish(`scope-${String(i).padStart(2,'0')}`,'failed',50,502,'UPSTREAM','',false);}
  logs.start({id:'other-branch',userId:'one',characterId:'role',branchId:'alternate',model:'test',messages:[]});
  logs.start({id:'other-user',userId:'two',characterId:'role',branchId:'main-branch',model:'test',messages:[]});
  const filter={characterId:'role',branchId:'main-branch',status:'failed' as const};
  const pages=[logs.list(1,'one',filter),logs.list(2,'one',filter)];
  expect(pages.map(page=>page.items.length)).toEqual([30,5]);expect(pages[0]?.total).toBe(35);
  expect(new Set(pages.flatMap(page=>page.items.map(row=>row.id))).size).toBe(35);
  expect(logs.list(1,undefined,{user:"%' OR 1=1 --"}).total).toBe(0);
  expect(logs.list(1,undefined,{character:'%'}).total).toBe(0);
 }finally{logs.db.close();rmSync(root,{recursive:true,force:true});}
});
it('persists completed and interrupted calls, filters users, and bounds individual records',()=>{
 const root=mkdtempSync(join(tmpdir(),'phone-logs-'));let db=new PhoneChatLogs(root);
 try {
 db.start({id:'a',userId:'one',characterId:'role',model:'test',messages:[{role:'user',content:'hello'}]});db.finish('a','complete',250,200,null,'reply',false);
 db.start({id:'b',userId:'two',characterId:'role',model:'test',messages:'x'.repeat(300000)});db.db.close();db=new PhoneChatLogs(root);
 expect(db.list(1,'one').total).toBe(1);expect(db.get('a')).toMatchObject({status:'complete',response:'reply'});expect(db.get('b')).toMatchObject({status:'interrupted',errorCode:'SERVER_RESTART',truncated:1});expect(db.list(99).items).toEqual([]);
 }finally{db.db.close();rmSync(root,{recursive:true,force:true})}
});
