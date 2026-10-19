import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { PhoneInspections } from './inspection';
import { ImageMaterials } from '../services/image-materials';
import { PhoneInspectionRequestSchema, type PhoneInspectionRequest } from '@yelan/shared';
const roots: string[] = [], stores: PhoneInspections[] = [];
function database() { const root = mkdtempSync(join(tmpdir(), 'phone-inspection-')); roots.push(root); const db = new PhoneInspections(root); stores.push(db); return { root, db }; }
function request(overrides: Partial<PhoneInspectionRequest> = {}): PhoneInspectionRequest {
  return { ownerUserId: 'user-a', deviceId: 'device-a', revision: 1, records: [{ source: 'story', id: 'story-a', kind: 'story', title: '星河桥', characterIds: ['role-a'], sections: [{ title: '正文', text: '用户写下的故事正文。' }], deleted: false, truncated: false }], ...overrides };
}
afterEach(() => { for (const db of stores.splice(0)) { if (db.db.open) db.db.close(); } for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('operational phone inspection', () => {
  it('serves complete archived resources only through their owning record and indexes them in the library',async()=>{
    const root=mkdtempSync(join(tmpdir(),'phone-full-preview-'));roots.push(root);
    const materials=new ImageMaterials(join(root,'materials')),db=new PhoneInspections(root,materials);stores.push(db);
    try{
      const resourceBytes=Buffer.from('{"a":1}'),resourceId=createHash('sha256').update(resourceBytes).digest('hex');
      await db.retainAsset('user-a',resourceId,'application/json',resourceBytes);
      const full={version:1 as const,type:'document' as const,data:{body:'完整内容🌙'.repeat(160_000),file:`inspection-asset://${resourceId}`},assets:[{ref:`inspection-asset://${resourceId}`,id:resourceId,mime:'application/json',state:'stored' as const}],partial:false};
      const archive=Buffer.from(JSON.stringify(full)),parts=[];
      for(let offset=0;offset<archive.length;offset+=1_000_000){const data=archive.subarray(offset,offset+1_000_000),id=createHash('sha256').update(data).digest('hex');await db.retainAsset('user-a',id,'text/plain',data,{source:'archive'});parts.push({id,ref:`inspection-asset://${id}`,mime:'text/plain',source:'archive' as const,state:'stored' as const});}
      const preview={...full,data:{archiveParts:parts.map(p=>p.ref)},assets:parts};
      const value=request();value.records[0]!.preview=preview;db.ingest('user-a',value);
      const key=String(db.list({page:1}).items[0]!.key),file=materials.list(1,'user-a').items[0]!;
      expect(materials.list(1,'user-a').total).toBe(1);expect(file.mime).toBe('application/json');expect(file.links).toEqual([{recordKey:key,title:'星河桥'}]);
      const resource=db.db.prepare('SELECT id FROM asset_materials WHERE materialId=?').get(file.id) as {id:string};
      expect(db.getAsset(key,resource.id)?.data.toString()).toBe('{"a":1}');
      db.ingest('user-b',request({ownerUserId:'user-b'}));const other=String(db.list({page:1,userId:'user-b'}).items[0]!.key);
      expect(db.getAsset(other,resource.id)).toBeNull();
      expect(()=>db.ingest('user-b',{...value,ownerUserId:'user-b',revision:2})).toThrow('ARCHIVE_INVALID');
      expect(db.list({page:1,userId:'user-b'}).total).toBe(1);
    }finally{materials.db.close();}
  });
  it('keeps pre-preview writers compatible and hides snapshots after an older writer updates the text',()=>{
    const {db}=database(),value=request();
    value.records[0]!.preview={version:1,type:'document',data:{text:'第一版画面'},assets:[],partial:false};
    db.ingest('user-a',value);const key=String(db.list({page:1}).items[0]!.key);
    const columns=db.db.prepare('PRAGMA table_info(records)').all() as {name:string}[];
    expect(columns).toHaveLength(15);
    db.db.prepare('INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run('legacy-key','user-a','device-a','story','legacy','story','旧端记录','[]','[]','',2,'2026-10-12','2026-10-12',0,0);
    expect(db.get('legacy-key')).toMatchObject({title:'旧端记录',preview:null});
    db.db.prepare('UPDATE records SET revision=2,sections=? WHERE key=?').run(JSON.stringify([{title:'正文',text:'旧端更新的正文'}]),key);
    expect(db.get(key)).toMatchObject({preview:null,sections:[{title:'正文',text:'旧端更新的正文'}]});
  });
  it('retains private referenced media across deletion and restart without cross-user access',()=>{
    const {root,db}=database();const bytes=Buffer.from('OggS synthetic retained audio'),id=createHash('sha256').update(bytes).digest('hex');
    db.putAsset('user-a',id,'audio/ogg',bytes);
    const value=request();value.records[0]!.preview={version:1,type:'document',data:{audio:`inspection-asset://${id}`},assets:[{ref:`inspection-asset://${id}`,id,mime:'audio/ogg',state:'stored'}],partial:false};
    db.ingest('user-a',value);const key=String(db.list({page:1,userId:'user-a'}).items[0]!.key);
    expect(db.getAsset(key,id)?.data).toEqual(bytes);
    db.ingest('user-b',request({ownerUserId:'user-b',records:value.records}));const other=String(db.list({page:1,userId:'user-b'}).items[0]!.key);expect(db.getAsset(other,id)).toBeUndefined();
    db.ingest('user-a',{...value,revision:2,records:[{...value.records[0]!,deleted:true,sections:[],preview:undefined}]});
    expect(db.getAsset(key,id)?.data).toEqual(bytes);expect(db.getAsset(key,'f'.repeat(64))).toBeNull();
    expect(()=>db.putAsset('user-a',id,'text/html',bytes)).toThrow('ASSET_TYPE');
    db.db.close();const reopened=new PhoneInspections(root);stores.push(reopened);expect(reopened.getAsset(key,id)?.data).toEqual(bytes);
  });
  it('paginates filtered worldviews without duplicates or losing records', () => {
    const { db } = database();
    const base = request();
    for (const start of [0, 50]) db.ingest('user-a', { ...base, revision:start+1, records: Array.from({length:Math.min(50,65-start)}, (_, offset) => ({...base.records[0]!,id:`world-${start+offset}`,kind:'worldview',title:`world ${start+offset}`})) });
    db.ingest('user-b', request({ownerUserId:'user-b'}));
    db.ingest('user-b', request({ownerUserId:'user-b', revision:2, records:[{...base.records[0]!,id:'world-other',kind:'worldview'}]}));
    const pages = [1,2,3].map(page => db.list({page,kind:'worldview',userId:'user-a'}));
    expect(pages.map(p => p.items.length)).toEqual([30,30,5]);
    expect(pages.every(p => p.total===65)).toBe(true);
    expect(new Set(pages.flatMap(p => p.items.map(row => (row as {key:string}).key))).size).toBe(65);
    expect(pages[0]?.owners).toEqual([{userId:'user-a',total:65},{userId:'user-b',total:1}]);
  });
  it('stamps authenticated ownership and rejects forged user identities', () => {
    const { db } = database();
    expect(() => db.ingest('user-b', request())).toThrow('OWNER_MISMATCH');
    expect(db.list({ page: 1 }).total).toBe(0);
    db.ingest('user-a', request());
    expect(db.list({ page: 1, userId: 'user-b' }).total).toBe(0);
  });
  it('retains distinct users and devices without syncing or overwriting each other', () => {
    const { db } = database(); db.ingest('user-a', request()); db.ingest('user-a', request({ deviceId: 'device-b' })); db.ingest('user-b', request({ ownerUserId: 'user-b' }));
    expect(db.list({ page: 1 }).total).toBe(3); expect(db.list({ page: 1, userId: 'user-a' }).total).toBe(2);
  });
  it('rejects stale revisions and retains a deleted work for inspection', () => {
    const { db } = database(); const value = request();
    db.ingest('user-a', { ...value, revision: 5 });
    db.ingest('user-a', { ...value, revision: 4, records: [{ ...value.records[0]!, title: '旧请求' }] });
    const row = db.list({ page: 1 }).items[0] as { key: string; title: string };
    expect(row.title).toBe('星河桥');
    db.ingest('user-a', { ...value, revision: 6, records: [{ ...value.records[0]!, sections: [], deleted: true }] });
    const saved = db.get(row.key)!; expect(saved.deleted).toBe(1); expect(saved.sections[0]!.text).toBe('用户写下的故事正文。');
  });
  it('persists after restart and returns readable sections with paginated metadata', () => {
    const { root, db } = database(); db.ingest('user-a', request()); db.db.close();
    const reopened = new PhoneInspections(root); stores.push(reopened);
    const row = reopened.list({ page: 1, kind: 'story', q: '星河' }).items[0] as { key: string; sections?: string };
    expect(row.sections).toBeUndefined(); expect(reopened.get(row.key)!.sections).toHaveLength(1);
  });
  it('limits payloads and excludes arbitrary credential/configuration fields', () => {
    const value = request(); expect(PhoneInspectionRequestSchema.safeParse({ ...value, apiKey: 'private' }).success).toBe(false);
    expect(PhoneInspectionRequestSchema.safeParse({ ...value, records: [{ ...value.records[0], sections: [{ title: '正文', text: 'a'.repeat(200001) }] }] }).success).toBe(false);
  });
});
