// 迁移 GUI — Hono Node 服务器 + 单页 HTML
// 启动: pnpm db:gui  → 打开 http://localhost:5174
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSql, maskUrl } from '../client';
import { status, up, newMigration, reset, listTables, runQuery } from '../runner';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

const app = new Hono();
app.use('*', cors());

const sql = createSql();
const dbInfo = { url: maskUrl(process.env.DATABASE_URL!) };

app.get('/', (c) => c.html(html));

app.get('/api/info', (c) => c.json({
  db: dbInfo.url,
  destructiveAllowed: process.env.MIGRATE_ALLOW_DESTRUCTIVE === 'true',
}));

app.get('/api/status', async (c) => c.json(await status(sql)));

app.get('/api/tables', async (c) => c.json(await listTables(sql)));

app.post('/api/up', async (c) => {
  const applied: string[] = [];
  try {
    const result = await up(sql, { onProgress: (id) => applied.push(id) });
    return c.json({ ok: true, applied: result });
  } catch (e) {
    return c.json({ ok: false, applied, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

app.post('/api/new', async (c) => {
  const body = await c.req.json<{ name?: string }>();
  if (!body.name) return c.json({ ok: false, error: '缺少 name' }, 400);
  try {
    const result = newMigration(body.name);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.post('/api/query', async (c) => {
  const body = await c.req.json<{ sql?: string; mode?: 'read' | 'write' }>();
  if (!body.sql) return c.json({ ok: false, error: '缺少 sql' }, 400);
  try {
    const result = await runQuery(sql, body.sql, body.mode === 'write' ? 'write' : 'read');
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

app.post('/api/reset', async (c) => {
  try {
    const result = await reset(sql);
    return c.json({ ok: true, ...result });
  } catch (e) {
    return c.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

const port = Number(process.env.DB_GUI_PORT ?? 5174);
serve({ fetch: app.fetch, port });
console.log(`╭─────────────────────────────────────────╮`);
console.log(`│ 夜阑 · DB Migration GUI                 │`);
console.log(`├─────────────────────────────────────────┤`);
console.log(`│ DB:  ${dbInfo.url.padEnd(33)} │`);
console.log(`│ URL: http://localhost:${port}            │`);
console.log(`╰─────────────────────────────────────────╯`);
