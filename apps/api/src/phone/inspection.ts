import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PhoneInspectionRequestSchema, type PhoneInspectionRequest } from '@yelan/shared';

export class PhoneInspections {
  readonly db: Database.Database;
  constructor(root: string) {
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
  }
  ingest(userId: string, input: PhoneInspectionRequest) {
    const body = PhoneInspectionRequestSchema.parse(input);
    if (body.ownerUserId !== userId) throw new Error('INSPECTION_OWNER_MISMATCH');
    const now = new Date().toISOString();
    const statement = this.db.prepare(`INSERT INTO records VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(key) DO UPDATE SET kind=excluded.kind,title=excluded.title,characterIds=excluded.characterIds,
      sections=CASE WHEN excluded.deleted=1 THEN records.sections ELSE excluded.sections END,
      localUpdatedAt=excluded.localUpdatedAt,revision=excluded.revision,receivedAt=excluded.receivedAt,
      deleted=excluded.deleted,truncated=CASE WHEN excluded.deleted=1 THEN records.truncated ELSE excluded.truncated END
      WHERE excluded.revision>records.revision`);
    let accepted = 0;
    this.db.transaction(() => {
      for (const row of body.records) {
        const key = createHash('sha256').update(JSON.stringify([userId, body.deviceId, row.source, row.id])).digest('hex');
        accepted += statement.run(key, userId, body.deviceId, row.source, row.id, row.kind, row.title,
          JSON.stringify(row.characterIds), JSON.stringify(row.sections), row.localUpdatedAt ?? '',
          body.revision, now, now, Number(row.deleted), Number(row.truncated)).changes;
      }
    })();
    return { ok: true, accepted };
  }
  list(input: { page: number; userId?: string; kind?: string; q?: string }) {
    const clauses: string[] = [], args: string[] = [];
    if (input.userId) { clauses.push('userId=?'); args.push(input.userId); }
    if (input.kind) { clauses.push('kind=?'); args.push(input.kind); }
    if (input.q) { clauses.push('(title LIKE ? OR userId LIKE ? OR characterIds LIKE ?)'); args.push(...Array(3).fill(`%${input.q}%`)); }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const total = (this.db.prepare('SELECT count(*) n FROM records' + where).get(...args) as { n: number }).n;
    const items = this.db.prepare(`SELECT key,userId,deviceId,source,localId,kind,title,characterIds,localUpdatedAt,firstReceivedAt,receivedAt,deleted,truncated FROM records${where} ORDER BY receivedAt DESC,key LIMIT 30 OFFSET ?`).all(...args, (input.page - 1) * 30);
    return { items, total, page: input.page, pageSize: 30 };
  }
  get(key: string): (Record<string, unknown> & { characterIds: string[]; sections: { title: string; text: string }[] }) | null {
    const row = this.db.prepare('SELECT * FROM records WHERE key=?').get(key) as Record<string, unknown> | undefined;
    return row ? { ...row, characterIds: JSON.parse(String(row.characterIds)), sections: JSON.parse(String(row.sections)) } : null;
  }
}
let instance: PhoneInspections | undefined;
export function phoneInspections() {
  const root = process.env.YELAN_STATE_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), process.env.VITEST || process.env.NODE_ENV === 'test' ? '../../.local-test' : '../../.local');
  return instance ??= new PhoneInspections(resolve(root, 'phone-inspection'));
}
