import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
export class PhoneChatLogs {
  readonly db: Database.Database;
  constructor(root: string) {
    mkdirSync(root,{recursive:true});this.db=new Database(resolve(root,'phone-chat.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,userId TEXT,characterId TEXT,branchId TEXT,model TEXT,createdAt TEXT,status TEXT,elapsedMs INTEGER,upstreamStatus INTEGER,errorCode TEXT,request TEXT,response TEXT,truncated INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS calls_created ON calls(createdAt DESC); CREATE INDEX IF NOT EXISTS calls_user ON calls(userId,createdAt DESC);`);
    this.db.prepare("UPDATE calls SET status='interrupted',errorCode='SERVER_RESTART' WHERE status='processing'").run();
  }
  start(v:{id:string;userId:string;characterId:string;branchId?:string;model:string;messages:unknown}) {
    const text=JSON.stringify(v.messages),limit=256000;
    this.db.prepare('INSERT INTO calls VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)').run(v.id,v.userId,v.characterId,v.branchId??'',v.model,new Date().toISOString(),'processing',0,null,null,text.slice(0,limit),'',Number(text.length>limit));
  }
  finish(id:string,status:string,elapsedMs:number,upstreamStatus:number|null,errorCode:string|null,response:string,truncated:boolean) {
    this.db.prepare('UPDATE calls SET status=?,elapsedMs=?,upstreamStatus=?,errorCode=?,response=?,truncated=MAX(truncated,?) WHERE id=?').run(status,elapsedMs,upstreamStatus,errorCode,response,Number(truncated),id);
  }
  list(page:number,userId?:string) {
    const where=userId?' WHERE userId=?':'',args=userId?[userId]:[];
    const total=(this.db.prepare('SELECT count(*) n FROM calls'+where).get(...args) as {n:number}).n;
    const items=this.db.prepare('SELECT id,userId,characterId,branchId,model,createdAt,status,elapsedMs,upstreamStatus,errorCode,truncated FROM calls'+where+' ORDER BY createdAt DESC,id DESC LIMIT 30 OFFSET ?').all(...args,(page-1)*30);
    return {items,total,page,pageSize:30};
  }
  get(id:string) {return this.db.prepare('SELECT * FROM calls WHERE id=?').get(id);}
}
let instance:PhoneChatLogs|undefined;
export function phoneChatLogs() {
  const root=process.env.YELAN_STATE_DIR??resolve(dirname(fileURLToPath(import.meta.url)),'../../.local');
  return instance??=new PhoneChatLogs(resolve(root,'phone-chat'));
}
