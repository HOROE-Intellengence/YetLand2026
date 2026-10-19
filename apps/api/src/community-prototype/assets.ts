import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { HTTPException } from 'hono/http-exception';
import { PhoneRoleRulesSchema } from '@yelan/shared';
import type {
  CommunityTheme,
  CommunityThemeState,
  CommunityWorldbook,
} from '../../../../packages/shared/src/contracts/community-resources';
import { charactersService } from '../services/characters';
import { store } from '../store/persistence';
import type { PrototypeResource } from './catalog';

type Asset = {
  id: string;
  userId: string;
  resourceId: string;
  version: string;
  type: 'worldbook' | 'theme';
  title: string;
  payload: CommunityWorldbook | CommunityTheme;
  installedAt: string;
};
const deny = (status: 403 | 404 | 409, message: string): never => {
  throw new HTTPException(status, { message });
};
export class AccountAssets {
  constructor(private db: Database.Database) {
    db.exec(`CREATE TABLE IF NOT EXISTS community_assets(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,resource_id TEXT NOT NULL,version TEXT NOT NULL,type TEXT NOT NULL,title TEXT NOT NULL,json TEXT NOT NULL,installed_at TEXT NOT NULL,UNIQUE(user_id,resource_id,version));
      CREATE TABLE IF NOT EXISTS community_bindings(user_id TEXT NOT NULL,asset_id TEXT NOT NULL,character_id TEXT NOT NULL,json TEXT NOT NULL,PRIMARY KEY(user_id,asset_id,character_id));
      CREATE TABLE IF NOT EXISTS community_theme_state(user_id TEXT PRIMARY KEY,asset_id TEXT,revision TEXT NOT NULL);`);
  }
  list(userId: string): Asset[] {
    return (
      this.db
        .prepare(
          'SELECT id,user_id userId,resource_id resourceId,version,type,title,json,installed_at installedAt FROM community_assets WHERE user_id=? ORDER BY installed_at DESC',
        )
        .all(userId) as (Omit<Asset, 'payload'> & { json: string })[]
    ).map(({ json, ...row }) => ({ ...row, payload: JSON.parse(json) }));
  }
  get(userId: string, id: string) {
    return this.list(userId).find((a) => a.id === id) || deny(404, '私有资源不存在');
  }
  bindings(userId: string) {
    return this.db
      .prepare(
        'SELECT asset_id assetId,character_id characterId FROM community_bindings WHERE user_id=?',
      )
      .all(userId) as { assetId: string; characterId: string }[];
  }
  theme(userId: string): CommunityThemeState {
    const row = this.db
      .prepare('SELECT asset_id id,revision FROM community_theme_state WHERE user_id=?')
      .get(userId) as { id: string | null; revision: string } | undefined;
    const asset = row?.id && this.list(userId).find((a) => a.id === row.id);
    return {
      revision: row?.revision || 'initial',
      installationId: asset ? asset.id : null,
      theme: asset ? (asset.payload as CommunityTheme) : null,
    };
  }
  install(userId: string, r: PrototypeResource) {
    const payload = r.type === 'worldbook' ? r.worldbook : r.theme;
    if (!payload) return deny(409, '此资源目前仅提供预览');
    const existing = this.list(userId).find(
      (a) => a.resourceId === r.id && a.version === r.version,
    );
    if (existing) return { asset: existing, alreadyInstalled: true };
    const id = `asset-${randomUUID()}`;
    this.db
      .prepare('INSERT INTO community_assets VALUES (?,?,?,?,?,?,?,?)')
      .run(
        id,
        userId,
        r.id,
        r.version,
        r.type,
        r.title,
        JSON.stringify(payload),
        new Date().toISOString(),
      );
    return { asset: this.get(userId, id), alreadyInstalled: false };
  }
  private role(userId: string, id: string) {
    const row = charactersService.getRow(id);
    if (
      !row ||
      row.ownerUserId !== userId ||
      row.visibility !== 'private' ||
      row.origin !== 'user' ||
      !row.isActive
    )
      return deny(403, '请选择自己的私有角色');
    return row;
  }
  bind(userId: string, id: string, characterId: string) {
    const a = this.get(userId, id);
    if (a.type !== 'worldbook') return deny(409, '只有世界书可以绑定角色');
    const row = this.role(userId, characterId);
    if (this.bindings(userId).some((b) => b.assetId === id && b.characterId === characterId))
      return { alreadyBound: true };
    const rules = PhoneRoleRulesSchema.parse(row.phoneRules || {});
    const entries = (a.payload as CommunityWorldbook).entries.filter(
      (e) => !rules.worldBook.some((old) => JSON.stringify(old) === JSON.stringify(e)),
    );
    const next = PhoneRoleRulesSchema.safeParse({
      ...rules,
      worldBook: [...rules.worldBook, ...entries],
    });
    if (!next.success) return deny(409, '绑定后世界书将超过角色上限，请先整理已有条目');
    const before = row.phoneRules;
    row.phoneRules = next.data;
    row.updatedAt = new Date().toISOString();
    try {
      store.saveStrict();
    } catch (e) {
      row.phoneRules = before;
      throw e;
    }
    this.db
      .prepare('INSERT INTO community_bindings VALUES (?,?,?,?)')
      .run(userId, id, characterId, JSON.stringify(entries));
    return { alreadyBound: false };
  }
  unbind(userId: string, id: string, characterId: string) {
    this.get(userId, id);
    const row = this.role(userId, characterId);
    const binding = this.db
      .prepare(
        'SELECT json FROM community_bindings WHERE user_id=? AND asset_id=? AND character_id=?',
      )
      .get(userId, id, characterId) as { json: string } | undefined;
    if (!binding) return;
    const rules = PhoneRoleRulesSchema.parse(row.phoneRules || {});
    const entries = [...rules.worldBook];
    const transfers = this.bindings(userId)
      .filter((b) => b.characterId === characterId && b.assetId !== id)
      .map((b) => ({
        id: b.assetId,
        asset: this.get(userId, b.assetId),
        owned: JSON.parse(
          (
            this.db
              .prepare(
                'SELECT json FROM community_bindings WHERE user_id=? AND asset_id=? AND character_id=?',
              )
              .get(userId, b.assetId, characterId) as { json: string }
          ).json,
        ) as unknown[],
      }));
    for (const e of JSON.parse(binding.json)) {
      const i = entries.findIndex((old) => JSON.stringify(old) === JSON.stringify(e));
      if (i < 0) continue;
      const dependent = transfers.find((t) =>
        (t.asset.payload as CommunityWorldbook).entries?.some(
          (entry) => JSON.stringify(entry) === JSON.stringify(e),
        ),
      );
      if (dependent) {
        if (!dependent.owned.some((entry) => JSON.stringify(entry) === JSON.stringify(e)))
          dependent.owned.push(e);
      } else entries.splice(i, 1);
    }
    const before = row.phoneRules;
    row.phoneRules = { ...rules, worldBook: entries };
    row.updatedAt = new Date().toISOString();
    try {
      store.saveStrict();
    } catch (e) {
      row.phoneRules = before;
      throw e;
    }
    this.db.transaction(() => {
      for (const t of transfers)
        this.db
          .prepare(
            'UPDATE community_bindings SET json=? WHERE user_id=? AND asset_id=? AND character_id=?',
          )
          .run(JSON.stringify(t.owned), userId, t.id, characterId);
      this.db
        .prepare('DELETE FROM community_bindings WHERE user_id=? AND asset_id=? AND character_id=?')
        .run(userId, id, characterId);
    })();
  }
  activate(userId: string, id: string | null) {
    if (id && this.get(userId, id).type !== 'theme') return deny(409, '请选择主题资源');
    this.db
      .prepare(
        'INSERT INTO community_theme_state VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET asset_id=excluded.asset_id,revision=excluded.revision',
      )
      .run(userId, id, randomUUID());
    return this.theme(userId);
  }
}
