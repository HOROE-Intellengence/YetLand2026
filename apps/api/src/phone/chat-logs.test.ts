import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {PhoneChatLogs} from './chat-logs';
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
it('persists completed and interrupted calls, filters users, and bounds individual records',()=>{
 const root=mkdtempSync(join(tmpdir(),'phone-logs-'));let db=new PhoneChatLogs(root);
 try {
 db.start({id:'a',userId:'one',characterId:'role',model:'test',messages:[{role:'user',content:'hello'}]});db.finish('a','complete',250,200,null,'reply',false);
 db.start({id:'b',userId:'two',characterId:'role',model:'test',messages:'x'.repeat(300000)});db.db.close();db=new PhoneChatLogs(root);
 expect(db.list(1,'one').total).toBe(1);expect(db.get('a')).toMatchObject({status:'complete',response:'reply'});expect(db.get('b')).toMatchObject({status:'interrupted',errorCode:'SERVER_RESTART',truncated:1});expect(db.list(99).items).toEqual([]);
 }finally{db.db.close();rmSync(root,{recursive:true,force:true})}
});
