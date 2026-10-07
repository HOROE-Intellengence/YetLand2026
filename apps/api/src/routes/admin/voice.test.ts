import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VoiceDatabase } from '../../voice/database';
import { saveAudio } from '../../voice/audio';
import { createAdminVoiceRoute } from './voice';

type ListResult = { total: number; rows: { id: string; turnCount: number }[] };
type DetailResult = { turns: Record<string, unknown>[] };
const json = async <T>(response: Response | Promise<Response>): Promise<T> => (await response).json() as Promise<T>;

describe('admin voice records', () => {
  let root: string, db: VoiceDatabase;
  const headers = { Authorization: 'Bearer voice-test-admin' };
  beforeEach(async () => {
    vi.stubEnv('ADMIN_TOKEN', 'voice-test-admin');
    root = await mkdtemp(join(tmpdir(), 'yelan-admin-voice-'));
    db = new VoiceDatabase(root);
    const insert = db.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, NULL)');
    insert.run('s1', 'user1', 'character1', 'Leda', '2026-10-01T16:00:00.000Z');
    insert.run('s2', 'user2', 'character2', 'Charon', '2026-10-01T15:59:59.000Z');
    db.db.prepare(`INSERT INTO turns (id,sessionId,requestId,inputHash,status,createdAt,updatedAt,
      inputText,outputText,errorCode,prompt,promptHash,model) VALUES
      ('t1','s1','r1','hash','failed','2026-10-01T16:00:00.000Z','2026-10-01T16:00:01.000Z',
      '用户转写','部分回复','UPSTREAM_ERROR','private prompt','hash','model')`).run();
  });
  afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
  const request = (path: string, auth = headers) => createAdminVoiceRoute(() => db).request(path, { headers: auth });
  it('rejects anonymous and ordinary-user credentials for list, detail and audio before opening storage', async () => {
    const getDb = vi.fn(() => db), app = createAdminVoiceRoute(getDb);
    for (const path of ['/sessions', '/sessions/s1', '/assets/anything']) {
      for (const auth of [{}, { Authorization: 'Bearer regular-user-token' }] as Record<string, string>[]) {
        expect((await app.request(path, { headers: auth })).status).toBe(401);
      }
    }
    expect(getDb).not.toHaveBeenCalled();
  });
  it('lists existing sessions, including empty ones, with turn counts', async () => {
    const res = await request('/sessions');
    expect(res.headers.get('Cache-Control')).toContain('no-store');
    const data = await res.json() as ListResult;
    expect(data.total).toBe(2);
    expect(data.rows.map((r: { id: string; turnCount: number }) => [r.id, r.turnCount])).toEqual([['s1', 1], ['s2', 0]]);
  });
  it('filters exact users and UTC+8 date boundaries, without SQL interpolation', async () => {
    expect((await json<ListResult>(request('/sessions?userId=user1'))).total).toBe(1);
    expect((await json<ListResult>(request('/sessions?userId=' + encodeURIComponent("' OR 1=1 --")))).total).toBe(0);
    const data = await json<ListResult>(request('/sessions?from=2026-10-01T16:00:00.000Z&to=2026-10-02T16:00:00.000Z'));
    expect(data.rows.map((r: { id: string }) => r.id)).toEqual(['s1']);
  });
  it('paginates without dropping or repeating records', async () => {
    for (let i = 0; i < 31; i++) db.db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, NULL)').run(`extra${i}`, 'user1', 'c', 'Leda', '2026-09-01T00:00:00.000Z');
    const first = await json<ListResult>(request('/sessions')), second = await json<ListResult>(request('/sessions?page=2'));
    expect(first.total).toBe(33); expect(first.rows).toHaveLength(30); expect(second.rows).toHaveLength(3);
    expect(new Set([...first.rows, ...second.rows].map(r => r.id)).size).toBe(33);
  });
  it('rejects malformed filters and reports missing sessions', async () => {
    for (const query of ['page=0', 'page=1.2', 'page=Infinity', 'from=bad', 'from=2026-10-02&to=2026-10-01']) {
      expect((await request('/sessions?' + query)).status).toBe(400);
    }
    expect((await request('/sessions/missing')).status).toBe(404);
  });
  it('returns partial transcripts and failure reasons but never private prompts', async () => {
    const data = await json<DetailResult>(request('/sessions/s1'));
    expect(data.turns[0]).toMatchObject({ status: 'failed', errorCode: 'UPSTREAM_ERROR', inputText: '用户转写', inputAudio: null, outputAudio: null });
    expect(data.turns[0]).not.toHaveProperty('prompt');
    expect((await json<DetailResult>(request('/sessions/s2'))).turns).toEqual([]);
  });
  it('reads both archived audio directions with metadata and protected binary responses', async () => {
    for (const direction of ['input', 'output'] as const) {
      const asset = await saveAudio(db, { userId: 'user1', turnId: 't1', direction, pcm: Buffer.alloc(3200), rate: 16000 });
      const response = await request(`/assets/${asset.id}`);
      expect(response.status).toBe(200); expect(response.headers.get('content-type')).toContain('audio/ogg');
      expect(response.headers.get('cache-control')).toContain('no-store');
      expect(Buffer.from(await response.arrayBuffer()).subarray(0, 4).toString()).toBe('OggS');
      const detail = await json<DetailResult>(request('/sessions/s1'));
      expect(detail.turns[0]![`${direction}Audio`]).toEqual({ id: asset.id, durationMs: 100 });
    }
  });
  it('reports missing and corrupted audio explicitly', async () => {
    expect((await request('/assets/missing')).status).toBe(404);
    const asset = await saveAudio(db, { userId: 'user1', turnId: 't1', direction: 'input', pcm: Buffer.alloc(3200), rate: 16000 });
    await writeFile(join(root, 'assets', asset.filename), 'broken');
    expect((await request(`/assets/${asset.id}`)).status).toBe(410);
    await unlink(join(root, 'assets', asset.filename));
    expect((await request(`/assets/${asset.id}`)).status).toBe(410);
  });
});
