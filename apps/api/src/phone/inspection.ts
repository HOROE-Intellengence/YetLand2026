import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PhoneInspectionRequestSchema, PhoneInspectionArchiveSchema, INSPECTION_ASSET_LIMIT, INSPECTION_IMAGE_INPUT_LIMIT, INSPECTION_ASSET_MIME, phonePreviewText, type PhoneInspectionRequest, type PhoneInspectionPreview } from '@yelan/shared';
import { ImageMaterials, imageMaterials, type MaterialSource } from '../services/image-materials';

export class PhoneInspections {
  readonly db: Database.Database;
  private materialStore?: ImageMaterials;
  constructor(private readonly root: string, materials?: ImageMaterials) {
    this.materialStore = materials;
    mkdirSync(root, { recursive: true });
    this.db = new Database(resolve(root, 'inspection.sqlite'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`CREATE TABLE IF NOT EXISTS records (
      key TEXT PRIMARY KEY, userId TEXT NOT NULL, deviceId TEXT NOT NULL, source TEXT NOT NULL,
      localId TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, characterIds TEXT NOT NULL,
      sections TEXT NOT NULL, localUpdatedAt TEXT, revision INTEGER NOT NULL,
      firstReceivedAt TEXT NOT NULL, receivedAt TEXT NOT NULL, deleted INTEGER NOT NULL, truncated INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS inspection_user ON records(userId, receivedAt DESC);
      CREATE INDEX IF NOT EXISTS inspection_kind ON records(kind, receivedAt DESC);`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS previews(key TEXT PRIMARY KEY,preview TEXT NOT NULL,revision INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS assets(userId TEXT NOT NULL,id TEXT NOT NULL,mime TEXT NOT NULL,data BLOB NOT NULL,createdAt TEXT NOT NULL,PRIMARY KEY(userId,id));`);
    this.db.exec(`CREATE TABLE IF NOT EXISTS asset_materials(userId TEXT NOT NULL,id TEXT NOT NULL,materialId TEXT NOT NULL,bytes INTEGER NOT NULL,PRIMARY KEY(userId,id));
      CREATE TABLE IF NOT EXISTS record_assets(recordKey TEXT NOT NULL,userId TEXT NOT NULL,assetId TEXT NOT NULL,PRIMARY KEY(recordKey,assetId));`);
    // Preview storage leaves the original 15-column table usable by older writers.
    const columns = this.db.prepare('PRAGMA table_info(records)').all() as { name: string }[];
    if (columns.some(c => c.name === 'preview')) this.db.exec('INSERT OR IGNORE INTO previews SELECT key,preview,revision FROM records WHERE preview IS NOT NULL');
  }
  ingest(userId: string, input: PhoneInspectionRequest) {
    const body = PhoneInspectionRequestSchema.parse(input);
    if (body.ownerUserId !== userId) throw new Error('INSPECTION_OWNER_MISMATCH');
    const now = new Date().toISOString();
    const statement = this.db.prepare(`INSERT INTO records(key,userId,deviceId,source,localId,kind,title,characterIds,sections,localUpdatedAt,revision,firstReceivedAt,receivedAt,deleted,truncated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET kind=excluded.kind,title=excluded.title,characterIds=excluded.characterIds,
      sections=CASE WHEN excluded.deleted=1 THEN records.sections ELSE excluded.sections END,
      localUpdatedAt=excluded.localUpdatedAt,revision=excluded.revision,receivedAt=excluded.receivedAt,
      deleted=excluded.deleted,truncated=CASE WHEN excluded.deleted=1 THEN records.truncated ELSE excluded.truncated END
      WHERE excluded.revision>records.revision`);
    const savePreview=this.db.prepare('INSERT INTO previews VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET preview=excluded.preview,revision=excluded.revision');
    const clearPreview=this.db.prepare('DELETE FROM previews WHERE key=?');
    let accepted = 0;
    this.db.transaction(() => {
      for (const row of body.records) {
        const key = createHash('sha256').update(JSON.stringify([userId, body.deviceId, row.source, row.id])).digest('hex');
        const changed=statement.run(key, userId, body.deviceId, row.source, row.id, row.kind, row.title,
          JSON.stringify(row.characterIds), JSON.stringify(row.sections), row.localUpdatedAt ?? '',
          body.revision, now, now, Number(row.deleted), Number(row.truncated)).changes;
        accepted+=changed;
        if(changed&&!row.deleted){
          if(row.preview)savePreview.run(key,JSON.stringify(row.preview),body.revision);else clearPreview.run(key);
          this.db.prepare('DELETE FROM record_assets WHERE recordKey=?').run(key);
          const full = row.preview ? this.expandPreview(userId,row.preview) : null;
          for (const asset of new Map([...(row.preview?.assets || []),...(full?.assets || [])].map(asset=>[asset.id||asset.ref,asset])).values()) {
            if (asset.state !== 'stored' || !asset.id || !this.readAsset(userId,asset.id)) continue;
            this.db.prepare('INSERT OR IGNORE INTO record_assets VALUES (?,?,?)').run(key,userId,asset.id);
            const link = this.db.prepare('SELECT materialId FROM asset_materials WHERE userId=? AND id=?').get(userId,asset.id) as {materialId:string} | undefined;
            if(link){this.materials().link(link.materialId,key,row.title);if(asset.source==='user-upload')this.materials().markUploaded(link.materialId);}
          }
        }
      }
    })();
    return { ok: true, accepted };
  }
  list(input: { page: number; userId?: string; kind?: string; q?: string }) {
    const clauses: string[] = [], args: string[] = [];
    if (input.userId) { clauses.push('userId=?'); args.push(input.userId); }
    if (input.kind) { clauses.push('kind=?'); args.push(input.kind); }
    if (input.q) { clauses.push('(title LIKE ? OR userId LIKE ? OR characterIds LIKE ? OR sections LIKE ?)'); args.push(...Array(4).fill(`%${input.q}%`)); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const total = (this.db.prepare('SELECT count(*) n FROM records' + where).get(...args) as { n: number }).n;
    const items = (this.db.prepare(`SELECT r.key,userId,deviceId,source,localId,kind,title,characterIds,localUpdatedAt,firstReceivedAt,receivedAt,deleted,truncated,sections,p.preview
      FROM records r LEFT JOIN previews p ON p.key=r.key AND (p.revision=r.revision OR r.deleted=1)${where} ORDER BY receivedAt DESC,r.key LIMIT 30 OFFSET ?`).all(...args, (input.page - 1) * 30) as Record<string, unknown>[]).map(({sections, preview, ...row}) => {
      const blocks = JSON.parse(String(sections)) as { title: string; text: string }[];
      const prose = blocks.filter(s => !/entryHtml|gameHtml|draft|settings|manifest|permissions|assets|iconDataUrl/i.test(s.title));
      const wordCount = prose.reduce((n,s) => n+s.text.trim().length,0);
      const partial=preview?Boolean(JSON.parse(String(preview)).partial):false;
      return {...row,key:String(row.key),title:String(row.title), summary: phonePreviewText(prose.map(s=>s.text).join('\n')), wordCount, sectionTitles: blocks.map(s=>s.title), previewAvailable:Boolean(preview), contentState:partial||(!preview&&row.truncated)?'partial':!wordCount&&!preview?'empty':'retained'};
    });
    // Creator choices cover the whole category, including users absent from the current page.
    return { items, total, page: input.page, pageSize: 30, owners: this.owners(input.kind) };
  }
  owners(kind?: string) {
    return this.db.prepare(`SELECT userId, count(*) AS total FROM records${kind ? ' WHERE kind=?' : ''} GROUP BY userId ORDER BY userId`)
      .all(...(kind ? [kind] : [])) as { userId: string; total: number }[];
  }
  get(key: string): (Record<string, unknown> & { characterIds: string[]; sections: { title: string; text: string }[] }) | null {
    const result = this.db.prepare('SELECT r.*,p.preview AS inspectionPreview FROM records r LEFT JOIN previews p ON p.key=r.key AND (p.revision=r.revision OR r.deleted=1) WHERE r.key=?').get(key) as Record<string, unknown> | undefined;
    if(!result)return null;
    const {inspectionPreview,...row}=result;
    return { ...row, characterIds: JSON.parse(String(row.characterIds)), sections: JSON.parse(String(row.sections)), preview: inspectionPreview ? JSON.parse(String(inspectionPreview)) : null };
  }
  putAsset(userId: string, id: string, mime: string, data: Buffer) {
    if (!/^[a-f0-9]{64}$/.test(id) || createHash('sha256').update(data).digest('hex') !== id) throw new Error('INSPECTION_ASSET_INVALID');
    if (!INSPECTION_ASSET_MIME.test(mime)) throw new Error('INSPECTION_ASSET_TYPE');
    if (!data.length || data.length > INSPECTION_ASSET_LIMIT) throw new Error('INSPECTION_ASSET_TOO_LARGE');
    const saved = this.db.prepare('SELECT mime FROM assets WHERE userId=? AND id=?').get(userId,id);
    if (saved) return {ok:true,id};
    const used = (this.db.prepare('SELECT coalesce(sum(coalesce(m.bytes,length(a.data))),0) AS n FROM assets a LEFT JOIN asset_materials m ON a.userId=m.userId AND a.id=m.id WHERE a.userId=?').get(userId) as {n:number}).n;
    if (used+data.length>256*1024*1024) throw new Error('INSPECTION_ASSET_QUOTA');
    this.db.prepare('INSERT INTO assets VALUES (?,?,?,?,?)').run(userId,id,mime,data,new Date().toISOString());
    return {ok:true,id};
  }
  private materials() { return this.materialStore ??= new ImageMaterials(resolve(this.root,'materials')); }
  async retainAsset(userId: string, id: string, mime: string, data: Buffer, info: {source?: MaterialSource;name?: string} = {}) {
    if(!/^[a-f0-9]{64}$/.test(id)||createHash('sha256').update(data).digest('hex')!==id)throw new Error('INSPECTION_ASSET_INVALID');
    if(!INSPECTION_ASSET_MIME.test(mime))throw new Error('INSPECTION_ASSET_TYPE');
    if(!data.length||data.length>(mime.startsWith('image/')?INSPECTION_IMAGE_INPUT_LIMIT:INSPECTION_ASSET_LIMIT))throw new Error('INSPECTION_ASSET_TOO_LARGE');
    const priorUsed=(this.db.prepare('SELECT coalesce(sum(length(data)),0) n FROM assets WHERE userId=? AND id<>?').get(userId,id) as {n:number}).n;
    const material = await this.materials().retain({userId,data,mime,source:info.source || 'phone-inspection',fileName:info.name,maxBytes:Math.max(0,256*1024*1024-priorUsed)});
    this.db.transaction(()=>{
      const used=(this.db.prepare('SELECT coalesce(sum(length(data)),0) n FROM assets WHERE userId=? AND id<>?').get(userId,id) as {n:number}).n;
      if(used+material.bytes>256*1024*1024)throw new Error('INSPECTION_ASSET_QUOTA');
      this.db.prepare('INSERT INTO asset_materials VALUES (?,?,?,?) ON CONFLICT(userId,id) DO UPDATE SET materialId=excluded.materialId,bytes=excluded.bytes').run(userId,id,material.id,material.bytes);
      // Previous versions can still read retained media after a code rollback.
      this.db.prepare('INSERT INTO assets VALUES (?,?,?,?,?) ON CONFLICT(userId,id) DO UPDATE SET data=excluded.data,mime=excluded.mime').run(userId,id,material.mime,material.data,new Date().toISOString());
    })();
    return {ok:true,id,materialId:material.id,mime:material.mime,bytes:material.bytes};
  }
  private readAsset(userId: string, id: string) {
    const link = this.db.prepare('SELECT materialId FROM asset_materials WHERE userId=? AND id=?').get(userId,id) as {materialId:string} | undefined;
    if(link){const file=this.materials().get(link.materialId,userId);return file?{mime:file.mime,data:file.data}:undefined;}
    return this.db.prepare('SELECT mime,data FROM assets WHERE userId=? AND id=?').get(userId,id) as {mime:string;data:Buffer}|undefined;
  }
  reindexMaterials() {
    let linked=0;
    for(const {key,userId,title,preview} of this.db.prepare('SELECT r.key,r.userId,r.title,p.preview FROM records r JOIN previews p ON r.key=p.key WHERE p.revision=r.revision OR r.deleted=1').all() as {key:string;userId:string;title:string;preview:string}[]){
      const header=JSON.parse(preview) as PhoneInspectionPreview,full=this.expandPreview(userId,header);
      for(const asset of new Map([...header.assets,...full.assets].map(asset=>[asset.id||asset.ref,asset])).values()){
        if(!asset.id||asset.state!=='stored')continue;
        const mapping=this.db.prepare('SELECT materialId FROM asset_materials WHERE userId=? AND id=?').get(userId,asset.id) as {materialId:string}|undefined;
        if(!mapping)continue;
        this.db.prepare('INSERT OR IGNORE INTO record_assets VALUES (?,?,?)').run(key,userId,asset.id);
        this.materials().link(mapping.materialId,key,title);if(asset.source==='user-upload')this.materials().markUploaded(mapping.materialId);linked++;
      }
    }
    return linked;
  }
  private expandPreview(userId: string, preview: PhoneInspectionPreview) {
    if(!Array.isArray(preview.data.archiveParts))return preview;
    const parts = preview.data.archiveParts;
    if(parts.length>120)throw new Error('INSPECTION_ARCHIVE_INVALID');
    const chunks:Buffer[]=[];let bytes=0;
    for(const ref of parts){
      const asset=preview.assets.find(a=>a.ref===ref && a.state==='stored' && a.source==='archive');
      const file=asset?.id?this.readAsset(userId,asset.id):undefined;
      if(!file||file.mime!=='text/plain')throw new Error('INSPECTION_ARCHIVE_INVALID');
      bytes+=file.data.length;if(bytes>64_000_000)throw new Error('INSPECTION_ARCHIVE_TOO_LARGE');chunks.push(file.data);
    }
    return PhoneInspectionArchiveSchema.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  }
  getAsset(recordKey: string, assetId: string) {
    const record = this.get(recordKey);
    if (!record || !/^[a-f0-9]{64}$/.test(assetId)) return null;
    const preview = record.preview as {assets?:{id?:string}[]} | null;
    if (!preview?.assets?.some(a=>a.id===assetId) && !this.db.prepare('SELECT 1 FROM record_assets WHERE recordKey=? AND userId=? AND assetId=?').get(recordKey,record.userId,assetId)) return null;
    return this.readAsset(String(record.userId),assetId);
  }
}
let instance: PhoneInspections | undefined;
export function phoneInspections() {
  const root = process.env.YELAN_STATE_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), process.env.VITEST || process.env.NODE_ENV === 'test' ? '../../.local-test' : '../../.local');
  return instance ??= new PhoneInspections(resolve(root, 'phone-inspection'), imageMaterials());
}
