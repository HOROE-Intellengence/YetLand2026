import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { UserCharacterCreateSchema } from '@yelan/shared';
import {
  CommunityWorldbookSchema,
  CommunityThemeSchema,
} from '../../../../packages/shared/src/contracts/community-resources';
import { resources, type PrototypeResource } from './catalog';

export type Role = 'member' | 'moderator' | 'admin';
export type Account = {
  userId: string;
  role: Role;
  status: 'active' | 'banned' | 'deleted';
  reason: string;
};
export type Resource = {
  id: string;
  ownerId: string;
  status: 'draft' | 'published' | 'offline';
  liveVersion: string | null;
  tid: number | null;
  pid: number | null;
  reason: string;
  updatedAt: string;
};
export type Revision = {
  resourceId: string;
  version: string;
  status: 'draft' | 'pending' | 'approved' | 'rejected' | 'published';
  data: PrototypeResource;
  reason: string;
  createdAt: string;
};
export type SyncJob = {
  id: string;
  resourceId: string;
  version: string;
  action: 'publish' | 'offline';
  actorId: string;
  attempts: number;
  status: string;
  error: string;
};

export const SubmissionSchema = z
  .object({
    type: z.enum(['character', 'worldbook', 'theme']),
    title: z.string().trim().min(2).max(80),
    subtitle: z.string().trim().min(2).max(120),
    description: z.string().trim().min(8).max(6000),
    tags: z.array(z.string().trim().min(1).max(16)).max(8).default([]),
    version: z.string().regex(/^\d{1,4}\.\d{1,4}\.\d{1,4}$/),
    payload: UserCharacterCreateSchema.optional(),
    worldbook: CommunityWorldbookSchema.optional(),
    theme: CommunityThemeSchema.optional(),
    sourceTid: z.number().int().positive().optional(),
    consent: z.literal(true),
  })
  .superRefine((data, ctx) => {
    if (data.type === 'character' && !data.payload)
      ctx.addIssue({ code: 'custom', path: ['payload'], message: '角色卡需要完整内容' });
    if (data.type !== 'character' && data.payload)
      ctx.addIssue({ code: 'custom', path: ['payload'], message: '角色内容与资源类型不匹配' });
    if (data.type === 'worldbook' && !data.worldbook)
      ctx.addIssue({ code: 'custom', path: ['worldbook'], message: '请提供世界书条目' });
    if (data.type === 'theme' && !data.theme)
      ctx.addIssue({ code: 'custom', path: ['theme'], message: '请提供主题配色或壁纸' });
    if ((data.worldbook && data.type !== 'worldbook') || (data.theme && data.type !== 'theme'))
      ctx.addIssue({ code: 'custom', message: '安装包与资源类型不匹配' });
  });

export class Repository {
  db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS installations(user_id TEXT NOT NULL, resource_id TEXT NOT NULL, version TEXT NOT NULL, character_id TEXT NOT NULL, installed_at TEXT NOT NULL, PRIMARY KEY(user_id,resource_id,version));
      CREATE TABLE IF NOT EXISTS community_accounts(user_id TEXT PRIMARY KEY, role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active', reason TEXT NOT NULL DEFAULT '');
      CREATE TABLE IF NOT EXISTS community_sessions(hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, yelan_token TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS community_resources(id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, status TEXT NOT NULL, live_version TEXT, tid INTEGER UNIQUE, pid INTEGER, reason TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS community_revisions(resource_id TEXT NOT NULL, version TEXT NOT NULL, status TEXT NOT NULL, json TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, PRIMARY KEY(resource_id,version));
      CREATE TABLE IF NOT EXISTS community_sync(id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, version TEXT NOT NULL, action TEXT NOT NULL, actor_id TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending', error TEXT NOT NULL DEFAULT '', UNIQUE(resource_id,version,action));
      CREATE TABLE IF NOT EXISTS community_audit(id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, action TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS community_events(id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
    `);
    const migrate = this.db.transaction(() => {
      for (const r of resources) {
        this.db
          .prepare(
            'INSERT OR IGNORE INTO community_resources(id,owner_id,status,live_version,updated_at) VALUES (?,?,?,?,?)',
          )
          .run(r.id, 'official-editor', 'published', r.version, new Date().toISOString());
        this.db
          .prepare(
            'INSERT OR IGNORE INTO community_revisions(resource_id,version,status,json,created_at) VALUES (?,?,?,?,?)',
          )
          .run(r.id, r.version, 'published', JSON.stringify(r), new Date().toISOString());
      }
      // An interrupted sync may be retried; the NodeBB side uses stable resource IDs.
      this.db.prepare("UPDATE community_sync SET status='pending' WHERE status='running'").run();
      this.db.prepare('DELETE FROM community_sessions WHERE expires<?').run(Date.now());
    });
    migrate();
  }
  account(userId: string): Account {
    this.db.prepare('INSERT OR IGNORE INTO community_accounts(user_id) VALUES (?)').run(userId);
    return this.db
      .prepare('SELECT user_id userId,role,status,reason FROM community_accounts WHERE user_id=?')
      .get(userId) as Account;
  }
  resource(id: string): Resource | undefined {
    return this.db
      .prepare(
        'SELECT id,owner_id ownerId,status,live_version liveVersion,tid,pid,reason,updated_at updatedAt FROM community_resources WHERE id=?',
      )
      .get(id) as Resource | undefined;
  }
  list(): Resource[] {
    return this.db
      .prepare(
        'SELECT id,owner_id ownerId,status,live_version liveVersion,tid,pid,reason,updated_at updatedAt FROM community_resources ORDER BY updated_at DESC,id',
      )
      .all() as Resource[];
  }
  revision(id: string, version: string): Revision | undefined {
    const row = this.db
      .prepare(
        'SELECT resource_id resourceId,version,status,json,reason,created_at createdAt FROM community_revisions WHERE resource_id=? AND version=?',
      )
      .get(id, version) as (Omit<Revision, 'data'> & { json: string }) | undefined;
    if (!row) return undefined;
    const { json, ...rest } = row;
    return { ...rest, data: JSON.parse(json) as PrototypeResource };
  }
  revisions(id: string): Revision[] {
    return (
      this.db
        .prepare(
          'SELECT version FROM community_revisions WHERE resource_id=? ORDER BY created_at DESC,rowid DESC',
        )
        .all(id) as { version: string }[]
    ).map((r) => this.revision(id, r.version)!);
  }
  audit(actor: string, action: string, target: string, detail: unknown = {}) {
    this.db
      .prepare(
        'INSERT INTO community_audit(actor_id,action,target,detail,created_at) VALUES (?,?,?,?,?)',
      )
      .run(actor, action, target, JSON.stringify(detail), new Date().toISOString());
  }
  job(resourceId: string, version: string, action: 'publish' | 'offline', actorId: string) {
    this.db
      .prepare(
        "INSERT INTO community_sync(id,resource_id,version,action,actor_id) VALUES (?,?,?,?,?) ON CONFLICT(resource_id,version,action) DO UPDATE SET actor_id=excluded.actor_id,attempts=0,status='pending',error=''",
      )
      .run(randomUUID(), resourceId, version, action, actorId);
  }
  jobs(): SyncJob[] {
    return this.db
      .prepare(
        'SELECT id,resource_id resourceId,version,action,actor_id actorId,attempts,status,error FROM community_sync ORDER BY rowid DESC LIMIT 100',
      )
      .all() as SyncJob[];
  }
  claimJob(id: string): SyncJob | undefined {
    const changed = this.db
      .prepare(
        "UPDATE community_sync SET status='running',attempts=attempts+1 WHERE id=? AND status='pending' AND attempts<5",
      )
      .run(id).changes;
    if (!changed) return undefined;
    return this.db
      .prepare(
        'SELECT id,resource_id resourceId,version,action,actor_id actorId,attempts,status,error FROM community_sync WHERE id=?',
      )
      .get(id) as SyncJob;
  }
  pendingJobs(): SyncJob[] {
    return this.db
      .prepare(
        "SELECT id,resource_id resourceId,version,action,actor_id actorId,attempts,status,error FROM community_sync WHERE status='pending' AND attempts<5 ORDER BY rowid LIMIT 25",
      )
      .all() as SyncJob[];
  }
}
