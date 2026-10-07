import { Hono } from 'hono';
import { requireAdmin } from '../../middleware/auth';
import { voiceDatabase, type VoiceDatabase } from '../../voice/database';
import { readAudio } from '../../voice/audio';

export function createAdminVoiceRoute(getDb: () => VoiceDatabase = voiceDatabase): Hono {
  const app = new Hono();
  app.use('*', requireAdmin());
  app.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
  app.get('/sessions', (c) => {
    const page = Number(c.req.query('page') ?? '1');
    const from = c.req.query('from'), to = c.req.query('to');
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 ||
        (from && !Number.isFinite(Date.parse(from))) || (to && !Number.isFinite(Date.parse(to))) ||
        (from && to && Date.parse(from) >= Date.parse(to))) {
      return c.json({ message: '筛选条件无效' }, 400);
    }
    const clauses: string[] = [], args: string[] = [];
    const userId = c.req.query('userId')?.trim();
    if (userId) { clauses.push('s.userId = ?'); args.push(userId); }
    if (from) { clauses.push('s.createdAt >= ?'); args.push(new Date(from).toISOString()); }
    if (to) { clauses.push('s.createdAt < ?'); args.push(new Date(to).toISOString()); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const db = getDb().db;
    const total = (db.prepare(`SELECT count(*) AS n FROM sessions s ${where}`).get(...args) as { n: number }).n;
    const rows = db.prepare(`SELECT s.*, (SELECT count(*) FROM turns t WHERE t.sessionId=s.id) AS turnCount
      FROM sessions s ${where} ORDER BY s.createdAt DESC, s.id LIMIT 30 OFFSET ?`).all(...args, (page - 1) * 30);
    return c.json({ rows, total, page, pageSize: 30 });
  });
  app.get('/sessions/:id', (c) => {
    const db = getDb(), session = db.session(c.req.param('id'));
    if (!session) return c.json({ message: '语音会话不存在' }, 404);
    const audio = (id: string | null) => {
      const asset = id ? db.asset(id) : undefined;
      return asset ? { id: asset.id, durationMs: asset.durationMs } : null;
    };
    const turns = db.turns(session.id).map(t => ({
      id: t.id, createdAt: t.createdAt, status: t.status, errorCode: t.errorCode,
      inputText: t.inputText, outputText: t.outputText,
      inputTranscriptComplete: Boolean(t.inputTranscriptComplete),
      outputTranscriptComplete: Boolean(t.outputTranscriptComplete),
      inputAudio: audio(t.inputAssetId), outputAudio: audio(t.outputAssetId),
    }));
    return c.json({ session, turns });
  });
  // Fetch with the administrator header, then play a local blob; never put tokens in media URLs.
  app.get('/assets/:id', async (c) => {
    const db = getDb(), asset = db.asset(c.req.param('id'));
    if (!asset) return c.json({ message: '音频不存在' }, 404);
    try {
      const data = await readAudio(db, asset);
      return new Response(new Uint8Array(data), { headers: {
        'Content-Type': 'audio/ogg; codecs=opus', 'Content-Length': String(data.length),
        'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      } });
    } catch {
      return c.json({ message: '音频文件缺失或损坏，无法试听' }, 410);
    }
  });
  return app;
}

export const adminVoiceRoute = createAdminVoiceRoute();
