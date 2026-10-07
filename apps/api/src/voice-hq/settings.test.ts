import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VoiceDatabase } from '../voice/database';
import { createAdminHqVoiceRoute } from '../routes/admin/voice-hq';
import { settings, saveSlot, characterProfile } from './profiles';
import { charactersService } from '../services/characters';
import { store } from '../store/persistence';
import { HqVoiceService } from './service';

let root: string, db: VoiceDatabase;
const headers = { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' };
beforeEach(async () => {
  vi.stubEnv('ADMIN_TOKEN', 'test-admin'); vi.stubEnv('DEPLOY_MODE', 'local'); store.__resetForTests();
  root = await mkdtemp(join(tmpdir(), 'fish-library-')); db = new VoiceDatabase(root);
  charactersService.upsert({ id: 'test', slug: 'test', name: '角色', rarity: 'free', priceCandle: 0, boundaryDefault: 2, hqVoiceProfileId: 'young-female' });
});
afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); vi.unstubAllEnvs(); });
it('seeds four empty slots without relabelling old Gemini samples as Fish', () => {
  expect(settings(db).slots).toHaveLength(4);
  const p = characterProfile(db, 'test');
  expect(p.referenceId).toBeNull(); expect(p.voiceName).toBe('Fish 默认声音'); expect(p.style).toBe('');
});
it('enforces admin access on search, writes and preview and rejects invalid input', async () => {
  const tts = vi.fn(), list = vi.fn(), app = createAdminHqVoiceRoute(() => db, { tts, list });
  for (const [url, method] of [['/', 'GET'], ['/catalog', 'GET'], ['/preview', 'POST'], ['/slots/young-female', 'PUT']]) {
    expect((await app.request(url!, { method })).status).toBe(401);
  }
  expect(tts).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  expect((await app.request('/slots/young-female', { method: 'PUT', headers, body: JSON.stringify({ referenceId: '../invalid', reason: 'test' }) })).status).toBe(400);
});
it('saves manual IDs in exactly four defaults, persists and clears them', async () => {
  const app = createAdminHqVoiceRoute(() => db);
  const put = (category: string, referenceId: string | null) => app.request(`/slots/${category}`, { method: 'PUT', headers, body: JSON.stringify({referenceId, speed: 0.9, reason: 'test'}) });
  expect((await put('young-female','fish-ref')).status).toBe(200);
  db.close(); db = new VoiceDatabase(root);
  expect(characterProfile(db, 'test')).toMatchObject({referenceId:'fish-ref',speed:0.9,revision:2});
  expect((await put('extra-category','fish-ref')).status).toBe(400);
  expect((await put('young-female',null)).status).toBe(200);
  expect(settings(db).slots).toHaveLength(4);
  expect(characterProfile(db, 'test').referenceId).toBeNull();
});
it('keeps an in-flight snapshot stable while a default is edited', () => {
  saveSlot(db,'young-female','original-ref',1);
  const snapshot = characterProfile(db, 'test');
  saveSlot(db,'young-female','new-ref',1);
  expect(snapshot.referenceId).toBe('original-ref'); expect(characterProfile(db, 'test').referenceId).toBe('new-ref');
});
it('does not offer to retry a legacy Gemini reply using Fish', () => {
  const service = new HqVoiceService(db), s = service.create('user', 'test');
  db.db.prepare(`INSERT INTO turns (id,sessionId,requestId,inputHash,status,createdAt,updatedAt,prompt,promptHash,model) VALUES ('old',?,'old','hash','failed','now','now','','','main')`).run(s.id);
  db.db.prepare(`INSERT INTO hq_turns (turnId,stage,profileJson,mainCompleted) VALUES ('old','tts',?,1)`).run(JSON.stringify({id:'young-female',model:'gemini-3.8-flash-tts',voiceName:'Leda'}));
  expect(service.response(db.turn('old')!).canRetryTts).toBe(false);
});
