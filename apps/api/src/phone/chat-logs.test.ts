import {it,expect} from 'vitest';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {PhoneChatLogs} from './chat-logs';
it('persists completed and interrupted calls, filters users, and bounds individual records',()=>{
 const root=mkdtempSync(join(tmpdir(),'phone-logs-'));let db=new PhoneChatLogs(root);
 try {
 db.start({id:'a',userId:'one',characterId:'role',model:'test',messages:[{role:'user',content:'hello'}]});db.finish('a','complete',250,200,null,'reply',false);
 db.start({id:'b',userId:'two',characterId:'role',model:'test',messages:'x'.repeat(300000)});db.db.close();db=new PhoneChatLogs(root);
 expect(db.list(1,'one').total).toBe(1);expect(db.get('a')).toMatchObject({status:'complete',response:'reply'});expect(db.get('b')).toMatchObject({status:'interrupted',errorCode:'SERVER_RESTART',truncated:1});expect(db.list(99).items).toEqual([]);
 }finally{db.db.close();rmSync(root,{recursive:true,force:true})}
});
