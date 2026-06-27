// 迁移核心：列举 / 执行 / 创建 / 重置
// 设计: 文件名 NNNN_xxx.sql；_migrations 表记录已应用集合
import { readFileSync, readdirSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from './client';

const here = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_DIR = join(here, '..', 'migrations');

export interface Migration {
  id: string;          // "0001_init"（不含 .sql）
  filename: string;    // "0001_init.sql"
  number: number;      // 1
  path: string;
}

export interface MigrationStatus extends Migration {
  applied: boolean;
  appliedAt: string | null;
}

export function listMigrations(): Migration[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((filename) => {
      const id = filename.replace(/\.sql$/, '');
      const m = id.match(/^(\d+)_/);
      if (!m) throw new Error(`迁移文件名不合法（必须以数字开头，如 0001_xxx.sql）: ${filename}`);
      return { id, filename, number: Number(m[1]), path: join(MIGRATIONS_DIR, filename) };
    });
}

export async function ensureTable(sql: Sql): Promise<void> {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function status(sql: Sql): Promise<MigrationStatus[]> {
  await ensureTable(sql);
  const all = listMigrations();
  const applied = await sql<{ id: string; applied_at: Date }[]>`SELECT id, applied_at FROM _migrations`;
  const map = new Map(applied.map((a) => [a.id, a.applied_at]));
  return all.map((m) => {
    const at = map.get(m.id);
    return { ...m, applied: !!at, appliedAt: at ? at.toISOString() : null };
  });
}

/** 应用所有 pending 迁移；返回应用的 id 列表 */
export async function up(sql: Sql, opts?: { onProgress?: (id: string) => void }): Promise<string[]> {
  const all = await status(sql);
  const pending = all.filter((m) => !m.applied);
  const applied: string[] = [];

  for (const m of pending) {
    const content = readFileSync(m.path, 'utf8');
    if (!content.trim()) {
      console.warn(`[skip] ${m.id} 文件为空`);
      applied.push(m.id);
      await sql`INSERT INTO _migrations (id) VALUES (${m.id})`;
      continue;
    }
    // 单文件单事务：失败整体回滚
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO _migrations (id) VALUES (${m.id})`;
    });
    opts?.onProgress?.(m.id);
    applied.push(m.id);
  }
  return applied;
}

/** 创建新迁移文件，返回路径 */
export function newMigration(name: string): { path: string; id: string } {
  if (!/^[a-z0-9_]+$/i.test(name)) {
    throw new Error('迁移名只能含字母/数字/下划线，例: add_user_nickname');
  }
  const all = listMigrations();
  const next = (all.length === 0 ? 0 : Math.max(...all.map((m) => m.number))) + 1;
  const id = `${String(next).padStart(4, '0')}_${name}`;
  const path = join(MIGRATIONS_DIR, `${id}.sql`);
  writeFileSync(
    path,
    `-- ${id}\n-- 创建时间: ${new Date().toISOString()}\n-- TODO: 写本次结构变更的 SQL。\n--   · 必须可重入（CREATE TABLE IF NOT EXISTS / ON CONFLICT DO NOTHING）\n--   · 不要 DROP COLUMN，弃用先标 deprecated\n\nBEGIN;\n\n-- 你的 SQL 写在这里\n\nCOMMIT;\n`,
  );
  return { path, id };
}

/** 危险：清空所有表（包括 _migrations），从 0001 重新跑。需要 MIGRATE_ALLOW_DESTRUCTIVE=true */
export async function reset(sql: Sql): Promise<{ applied: string[] }> {
  if (process.env.MIGRATE_ALLOW_DESTRUCTIVE !== 'true') {
    throw new Error('reset 是破坏性操作。设置环境变量 MIGRATE_ALLOW_DESTRUCTIVE=true 后再试');
  }
  await sql.unsafe(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`);
  const applied = await up(sql);
  return { applied };
}

/** 给 GUI 用：列出当前 DB 里实际存在的表 + 行数（粗略） */
export async function listTables(sql: Sql): Promise<{ name: string; rows: number }[]> {
  const tables = await sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename
  `;
  const out: { name: string; rows: number }[] = [];
  for (const t of tables) {
    const r = await sql<{ count: number }[]>`SELECT count(*)::int FROM ${sql(t.tablename)}`;
    out.push({ name: t.tablename, rows: r[0]?.count ?? 0 });
  }
  return out;
}

/** 跑用户自定义查询。mode='read' 强制开 read-only 事务 */
export async function runQuery(sql: Sql, queryText: string, mode: 'read' | 'write'): Promise<{ rows: unknown[]; rowCount: number; durationMs: number }> {
  const t0 = Date.now();
  if (mode === 'read') {
    return await sql.begin(async (tx) => {
      await tx.unsafe('SET TRANSACTION READ ONLY');
      const rows = await tx.unsafe(queryText);
      return { rows: rows as unknown[], rowCount: (rows as unknown[]).length, durationMs: Date.now() - t0 };
    });
  }
  const rows = await sql.unsafe(queryText);
  return { rows: rows as unknown[], rowCount: (rows as unknown[]).length, durationMs: Date.now() - t0 };
}
