import Database from 'better-sqlite3';
import {mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import { phoneInputPreview, phonePreviewText, inferPhoneSource, type PhoneCallTrace, type PhoneChatLogDetail, type PhoneChatLogsQuery } from '@yelan/shared';

type StoredRow = Omit<PhoneChatLogDetail, 'userName' | 'characterName'>;
type ListRow = Omit<StoredRow, 'request' | 'response'>;
type Filters = Omit<PhoneChatLogsQuery, 'page' | 'userId'> & { matchingUserIds?: string[]; matchingCharacterIds?: string[] };
function preview(value: unknown): string {
  return phonePreviewText(value);
}
export class PhoneChatLogs {
  readonly db: Database.Database;
  constructor(root: string) {
    mkdirSync(root,{recursive:true});this.db=new Database(resolve(root,'phone-chat.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS calls(id TEXT PRIMARY KEY,userId TEXT,characterId TEXT,branchId TEXT,model TEXT,createdAt TEXT,status TEXT,elapsedMs INTEGER,upstreamStatus INTEGER,errorCode TEXT,request TEXT,response TEXT,truncated INTEGER DEFAULT 0);
      CREATE INDEX IF NOT EXISTS calls_created ON calls(createdAt DESC); CREATE INDEX IF NOT EXISTS calls_user ON calls(userId,createdAt DESC);`);
    const columns = this.db.prepare('PRAGMA table_info(calls)').all() as { name: string }[];
    for (const column of ['inputPreview', 'outputPreview']) {
      if (!columns.some(value => value.name === column)) this.db.exec(`ALTER TABLE calls ADD COLUMN ${column} TEXT`);
    }
    const traceColumns:Record<string,string>={sourceApp:"TEXT DEFAULT 'unknown'",sourceInferred:'INTEGER DEFAULT 1',sessionId:"TEXT DEFAULT ''",operation:"TEXT DEFAULT ''",turnId:"TEXT DEFAULT ''"};
    let migrated=false;
    for(const [column,definition]of Object.entries(traceColumns))if(!columns.some(c=>c.name===column)){this.db.exec(`ALTER TABLE calls ADD COLUMN ${column} ${definition}`);migrated=true;}
    if(migrated){
      const old=this.db.prepare('SELECT id,request,response,branchId FROM calls').all() as {id:string;request:string;response:string;branchId:string}[];
      const update=this.db.prepare('UPDATE calls SET sourceApp=?,inputPreview=?,outputPreview=? WHERE id=?');
      this.db.transaction(()=>{for(const row of old)update.run(inferPhoneSource(row.request,row.branchId),phoneInputPreview(row.request),preview(row.response),row.id);})();
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS calls_scope ON calls(userId,characterId,branchId,createdAt DESC,id DESC)');
    this.db.prepare("UPDATE calls SET status='interrupted',errorCode='SERVER_RESTART' WHERE status='processing'").run();
  }
  start(v:{id:string;userId:string;characterId:string;branchId?:string;model:string;messages:unknown;trace?:PhoneCallTrace}) {
    const text=JSON.stringify(v.messages),limit=256000;
    this.db.prepare(`INSERT INTO calls (id,userId,characterId,branchId,model,createdAt,status,elapsedMs,upstreamStatus,errorCode,request,response,truncated,inputPreview,outputPreview,sourceApp,sourceInferred,sessionId,operation,turnId)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(v.id,v.userId,v.characterId,v.branchId??'',v.model,new Date().toISOString(),'processing',0,null,null,text.slice(0,limit),'',Number(text.length>limit),phoneInputPreview(text),'',v.trace?.sourceApp||inferPhoneSource(text,v.branchId),v.trace?0:1,v.trace?.sessionId||'',v.trace?.operation||'',v.trace?.turnId||'');
  }
  finish(id:string,status:string,elapsedMs:number,upstreamStatus:number|null,errorCode:string|null,response:string,truncated:boolean) {
    this.db.prepare('UPDATE calls SET status=?,elapsedMs=?,upstreamStatus=?,errorCode=?,response=?,truncated=MAX(truncated,?),outputPreview=? WHERE id=?').run(status,elapsedMs,upstreamStatus,errorCode,response,Number(truncated),preview(response),id);
  }
  list(page:number,userId?:string,filters:Filters={}) {
    const clauses: string[] = [], args: string[] = [];
    if (userId) { clauses.push('userId=?'); args.push(userId); }
    if (filters.characterId) { clauses.push('characterId=?'); args.push(filters.characterId); }
    if (filters.branchId !== undefined) { clauses.push('branchId=?'); args.push(filters.branchId); }
    if (filters.status) { clauses.push('status=?'); args.push(filters.status); }
    if(filters.sourceApp){clauses.push('sourceApp=?');args.push(filters.sourceApp);}
    if(filters.sessionId!==undefined){clauses.push('sessionId=?');args.push(filters.sessionId);}
    if(filters.q){clauses.push('(instr(lower(request),lower(?))>0 OR instr(lower(response),lower(?))>0)');args.push(filters.q,filters.q);}
    if(filters.from){clauses.push('createdAt>=?');args.push(filters.from);}
    if(filters.to){clauses.push('createdAt<=?');args.push(filters.to);}
    if (filters.user) {
      clauses.push('(instr(lower(userId),lower(?))>0 OR userId IN (SELECT value FROM json_each(?)))');
      args.push(filters.user, JSON.stringify(filters.matchingUserIds ?? []));
    }
    if (filters.character) {
      clauses.push('(instr(lower(characterId),lower(?))>0 OR characterId IN (SELECT value FROM json_each(?)))');
      args.push(filters.character, JSON.stringify(filters.matchingCharacterIds ?? []));
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const scope="userId,characterId,sourceApp,CASE WHEN sessionId<>'' THEN sessionId ELSE date(createdAt)||':'||branchId END";
    const grouped=filters.grouped==='true';
    const total=(this.db.prepare(grouped?`SELECT count(*) n FROM (SELECT id FROM calls${where} GROUP BY ${scope})`:'SELECT count(*) n FROM calls'+where).get(...args) as {n:number}).n;
    // Summarize legacy archives only for this page, then cache. Lists never send full prompts.
    const from=grouped?`(SELECT *,row_number() OVER (PARTITION BY ${scope} ORDER BY createdAt DESC,id DESC) AS groupRow,count(*) OVER (PARTITION BY ${scope}) AS groupSize FROM calls${where}) WHERE groupRow=1`:`calls${where}`;
    const rows=this.db.prepare(`SELECT id,userId,characterId,branchId,model,createdAt,status,elapsedMs,upstreamStatus,errorCode,truncated,inputPreview,outputPreview,sourceApp,sourceInferred,sessionId,operation,turnId${grouped?',groupSize':''},
      CASE WHEN inputPreview IS NULL THEN request END AS previewRequest, CASE WHEN outputPreview IS NULL THEN response END AS previewResponse
      FROM ${from} ORDER BY createdAt ${filters.order==='asc'?'ASC':'DESC'},id ${filters.order==='asc'?'ASC':'DESC'} LIMIT 30 OFFSET ?`).all(...args,(page-1)*30) as (ListRow & { previewRequest: string | null; previewResponse: string | null })[];
    const cache = this.db.prepare('UPDATE calls SET inputPreview=?,outputPreview=? WHERE id=?');
    const items = this.db.transaction(() => rows.map(({ previewRequest, previewResponse, ...row }) => {
      if (row.inputPreview == null || row.outputPreview == null) {
        row.inputPreview ??= phoneInputPreview(previewRequest ?? '');
        row.outputPreview ??= preview(previewResponse);
        cache.run(row.inputPreview, row.outputPreview, row.id);
      }
      return row;
    }))();
    const sources=this.db.prepare('SELECT sourceApp AS id,count(*) AS count FROM calls GROUP BY sourceApp ORDER BY count DESC').all() as {id:string;count:number}[];
    return {items,total,page,pageSize:30,sources};
  }
  get(id:string): StoredRow | undefined {
    const row = this.db.prepare('SELECT * FROM calls WHERE id=?').get(id) as StoredRow | undefined;
    if (row) {
      row.inputPreview ??= phoneInputPreview(row.request);
      row.outputPreview ??= preview(row.response);
    }
    return row;
  }
  thread(id:string,page=1){
    const anchor=this.get(id);if(!anchor)return null;
    const filters:Filters={characterId:anchor.characterId,sourceApp:anchor.sourceApp,sessionId:anchor.sessionId,order:'asc'};
    if(!anchor.sessionId){filters.branchId=anchor.branchId;const day=anchor.createdAt.slice(0,10);filters.from=`${day}T00:00:00.000Z`;filters.to=`${day}T23:59:59.999Z`;}
    const result=this.list(page,anchor.userId,filters);
    return {...result,grouping:anchor.sessionId?'session':'historical',items:result.items.map(row=>this.get(row.id)!)};
  }
}
let instance:PhoneChatLogs|undefined;
export function phoneChatLogs() {
  const root=process.env.YELAN_STATE_DIR??resolve(dirname(fileURLToPath(import.meta.url)),'../../.local');
  return instance??=new PhoneChatLogs(resolve(root,'phone-chat'));
}
