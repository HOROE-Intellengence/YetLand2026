import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PhoneInspections } from './inspection';
import { PhoneInspectionRequestSchema, type PhoneInspectionRequest } from '@yelan/shared';
const roots: string[] = [], stores: PhoneInspections[] = [];
function database() { const root = mkdtempSync(join(tmpdir(), 'phone-inspection-')); roots.push(root); const db = new PhoneInspections(root); stores.push(db); return { root, db }; }
function request(overrides: Partial<PhoneInspectionRequest> = {}): PhoneInspectionRequest {
  return { ownerUserId: 'user-a', deviceId: 'device-a', revision: 1, records: [{ source: 'story', id: 'story-a', kind: 'story', title: '星河桥', characterIds: ['role-a'], sections: [{ title: '正文', text: '用户写下的故事正文。' }], deleted: false, truncated: false }], ...overrides };
}
afterEach(() => { for (const db of stores.splice(0)) { if (db.db.open) db.db.close(); } for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
describe('operational phone inspection', () => {
  it('paginates filtered worldviews without duplicates or losing records', () => {
    const { db } = database();
    const base = request();
    for (const start of [0, 50]) db.ingest('user-a', { ...base, revision:start+1, records: Array.from({length:Math.min(50,65-start)}, (_, offset) => ({...base.records[0]!,id:`world-${start+offset}`,kind:'worldview',title:`world ${start+offset}`})) });
    db.ingest('user-b', request({ownerUserId:'user-b'}));
    const pages = [1,2,3].map(page => db.list({page,kind:'worldview',userId:'user-a'}));
    expect(pages.map(p => p.items.length)).toEqual([30,30,5]);
    expect(pages.every(p => p.total===65)).toBe(true);
    expect(new Set(pages.flatMap(p => p.items.map(row => (row as {key:string}).key))).size).toBe(65);
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
