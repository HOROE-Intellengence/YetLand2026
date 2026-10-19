import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { VoiceDatabase } from '../voice/database';
import * as database from '../voice/database';
import { createAdminHqVoiceRoute } from '../routes/admin/voice-hq';
import { settings, saveSlot, characterProfile } from './profiles';
import { charactersService } from '../services/characters';
import { store } from '../store/persistence';
import { HqVoiceService } from './service';
import { createHqVoiceRoute } from '../routes/voice-hq';
import { adminCharactersRoute } from '../routes/admin/characters';
import { mockCreatedCharactersRoute } from '../routes/me/created-characters';
import { HqSessionResponseSchema, HqTurnResponseSchema, HqVoiceOptionsResponseSchema, type FishVoiceSettings } from '@yelan/shared';
import { randomUUID } from 'node:crypto';

let root: string, db: VoiceDatabase;
const headers = { Authorization: 'Bearer test-admin', 'Content-Type': 'application/json' };
beforeEach(async () => {
  vi.stubEnv('ADMIN_TOKEN', 'test-admin'); vi.stubEnv('DEPLOY_MODE', 'local'); store.__resetForTests();
  root = await mkdtemp(join(tmpdir(), 'fish-library-')); db = new VoiceDatabase(root);
  vi.spyOn(database, 'voiceDatabase').mockImplementation(() => db);
  charactersService.upsert({ id: 'test', slug: 'test', name: '角色', rarity: 'free', priceCandle: 0, boundaryDefault: 2, hqVoiceProfileId: 'young-female' });
});
afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });
it('seeds four empty slots without relabelling old Gemini samples as Fish', () => {
  expect(settings(db).slots).toHaveLength(4);
  const p = characterProfile(db, 'test');
  expect(p.referenceId).toBeNull(); expect(p.voiceName).toBe('Fish 默认声音'); expect(p.style).toBe('');
});
it('enforces admin access on search, writes and preview and rejects invalid input', async () => {
  const tts = vi.fn(), list = vi.fn(), app = createAdminHqVoiceRoute(() => db, { tts, list });
  for (const [url, method] of [['/', 'GET'], ['/catalog', 'GET'], ['/preview', 'POST'], ['/slots', 'POST'], ['/slots/young-female', 'PUT']]) {
    expect((await app.request(url!, { method })).status).toBe(401);
  }
  expect(tts).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled();
  expect((await app.request('/slots/young-female', { method: 'PUT', headers, body: JSON.stringify({ referenceId: '../invalid', reason: 'test' }) })).status).toBe(400);
});
it('updates, persists and clears existing entries without creating unknown IDs', async () => {
  const app = createAdminHqVoiceRoute(() => db);
  const put = (category: string, referenceId: string | null) => app.request(`/slots/${category}`, { method: 'PUT', headers, body: JSON.stringify({referenceId, speed: 0.9, reason: 'test'}) });
  expect((await put('young-female','fish-ref')).status).toBe(200);
  db.close(); db = new VoiceDatabase(root);
  expect(characterProfile(db, 'test')).toMatchObject({referenceId:'fish-ref',speed:0.9,revision:2});
  expect((await put('extra-category','fish-ref')).status).toBe(404);
  expect((await put('young-female',null)).status).toBe(200);
  expect(settings(db).slots).toHaveLength(4);
  expect(characterProfile(db, 'test').referenceId).toBeNull();
});
it('migrates four-slot databases without changing references, speeds, revisions or bindings', () => {
  db.db.exec(`CREATE TABLE fish_voice_defaults (
    category TEXT PRIMARY KEY, referenceId TEXT, speed REAL NOT NULL DEFAULT 1, revision INTEGER NOT NULL DEFAULT 1
  ); INSERT INTO fish_voice_defaults VALUES ('young-female','legacy-ref',0.9,7);`);
  expect(settings(db).slots).toHaveLength(4);
  expect(characterProfile(db, 'test')).toMatchObject({ id: 'young-female', label: '少女', referenceId: 'legacy-ref', speed: 0.9, revision: 7 });
  saveSlot(db, 'young-female', 'legacy-ref', 0.9, '自定义旧音色名称');
  expect(characterProfile(db, 'test').label).toBe('自定义旧音色名称');
  expect(settings(db).slots).toHaveLength(4);
});
it('rejects missing names, invalid Fish IDs and blank reasons when adding entries', async () => {
  const app = createAdminHqVoiceRoute(() => db);
  for (const patch of [{ label: '' }, { label: '  ' }, { label: '声'.repeat(41) }, { referenceId: '../bad' }, { reason: '' }]) {
    const res = await app.request('/slots', { method: 'POST', headers, body: JSON.stringify({ label: '新音色', referenceId: 'fish-new', reason: 'test', ...patch }) });
    expect(res.status).toBe(400);
  }
  expect(settings(db).slots).toHaveLength(4);
});
it('adds persistent voices, exposes choices, binds both kinds of roles and synthesizes with the selected entry', async () => {
  const admin = createAdminHqVoiceRoute(() => db);
  const response = await admin.request('/slots', { method: 'POST', headers, body: JSON.stringify({ label: '温柔姐姐', referenceId: 'fish-custom', speed: 0.9, reason: 'test' }) });
  expect(response.status).toBe(201);
  const added = ((await response.json()) as FishVoiceSettings).slots.at(-1)!;
  expect(added).toMatchObject({ label: '温柔姐姐', referenceId: 'fish-custom', speed: 0.9, revision: 1 });
  db.close(); db = new VoiceDatabase(root);
  expect(settings(db).slots).toHaveLength(5);
  expect(settings(db).slots.at(-1)).toEqual(added);

  store.state().users.owner = { id: 'owner', token: 'token-owner', ageVerified: true, narrativeBoundary: 2,
    ifUnlocked: false, createdAt: new Date().toISOString(), candle: 100, registerGrant: 100, conversationRounds: 0 };
  store.state().tokenIndex['token-owner'] = 'owner';
  const userHeaders = { Authorization: 'Bearer token-owner', 'Content-Type': 'application/json' };
  const tts = vi.fn(async () => Buffer.alloc(9600, 1));
  const service = new HqVoiceService(db, { main: vi.fn(async () => ({ text: '测试回复', model: 'test-main' })), tts, submit: vi.fn(), poll: vi.fn() });
  const route = createHqVoiceRoute(() => service);
  expect((await route.request('/profiles')).status).toBe(401);
  const options = HqVoiceOptionsResponseSchema.parse(await (await route.request('/profiles', { headers: userHeaders })).json());
  expect(options.options).toContainEqual({ value: added.category, label: added.label });
  expect(JSON.stringify(options)).not.toContain('fish-custom');

  const adminRole = await adminCharactersRoute.request('/', { method: 'POST', headers,
    body: JSON.stringify({ slug: 'custom-voice-role', name: '后台角色', rarity: 'free', priceCandle: 0, boundaryDefault: 2, reason: 'test', hqVoiceProfileId: added.category }) });
  expect(adminRole.status).toBe(201);
  expect(characterProfile(db, 'custom-voice-role').referenceId).toBe('fish-custom');
  const created = await mockCreatedCharactersRoute.request('/', { method: 'POST', headers: userHeaders,
    body: JSON.stringify({ name: '用户角色', consent: true, hqVoiceProfileId: added.category }) });
  expect(created.status).toBe(201);
  const { character } = await created.json() as { character: { id: string; hqVoiceProfileId: string } };
  expect(character.hqVoiceProfileId).toBe(added.category);

  const patch = await adminCharactersRoute.request('/test', { method: 'PATCH', headers, body: JSON.stringify({ hqVoiceProfileId: added.category, reason: 'test' }) });
  expect(patch.status).toBe(200);
  expect((await adminCharactersRoute.request('/test', { method: 'PATCH', headers, body: JSON.stringify({ name: '只改名字', reason: 'test' }) })).status).toBe(200);
  expect(charactersService.get('test')?.hqVoiceProfileId).toBe(added.category);

  vi.stubEnv('VOICE_HQ_FISH_API_KEY', 'test-key');
  const session = HqSessionResponseSchema.parse(service.create('owner', character.id));
  expect(session.profileId).toBe(added.category);
  expect(() => service.create('another-user', character.id)).toThrow('CHARACTER_NOT_FOUND');
  const turn = await service.start('owner', session.id, randomUUID(), Buffer.alloc(0), '你好');
  await vi.waitFor(() => expect(service.jobs.size).toBe(0), { timeout: 10000 });
  const result = HqTurnResponseSchema.parse(service.response(db.turn(turn.id)!));
  expect(result.status).toBe('complete');
  expect(result.profileId).toBe(added.category);
  expect(tts).toHaveBeenCalledWith('测试回复', expect.objectContaining({ id: added.category, referenceId: 'fish-custom', speed: 0.9 }), expect.any(AbortSignal));

  expect((await admin.request(`/slots/${added.category}`, { method: 'PUT', headers,
    body: JSON.stringify({ label: '新名称', referenceId: 'fish-updated', reason: 'test' }) })).status).toBe(200);
  expect(characterProfile(db, character.id)).toMatchObject({ id: added.category, label: '新名称', referenceId: 'fish-updated', revision: 2 });
  expect(service.meta(turn.id).profileJson).toContain('fish-custom');
});
it('rejects unconfigured voices in admin create, edit, import and user create', async () => {
  const role = { slug: 'invalid-voice-role', name: '角色', rarity: 'free', priceCandle: 0, boundaryDefault: 2, hqVoiceProfileId: 'unknown-voice', reason: 'test' };
  expect((await adminCharactersRoute.request('/', { method: 'POST', headers, body: JSON.stringify(role) })).status).toBe(400);
  expect((await adminCharactersRoute.request('/test', { method: 'PATCH', headers, body: JSON.stringify({ hqVoiceProfileId: 'unknown-voice', reason: 'test' }) })).status).toBe(400);
  const imported = await adminCharactersRoute.request('/import', { method: 'POST', headers, body: JSON.stringify({ raw: JSON.stringify({ card: role }), mode: 'create', reason: 'test' }) });
  expect(imported.status).toBe(400);
  expect(await imported.json()).toMatchObject({ errors: expect.arrayContaining([expect.objectContaining({ code: 'HQ_VOICE_UNAVAILABLE' })]) });
  store.state().users.owner = { id: 'owner', token: 'token-owner', ageVerified: true, narrativeBoundary: 2,
    ifUnlocked: false, createdAt: new Date().toISOString(), candle: 100, registerGrant: 100, conversationRounds: 0 };
  store.state().tokenIndex['token-owner'] = 'owner';
  expect((await mockCreatedCharactersRoute.request('/', { method: 'POST', headers: { ...headers, Authorization: 'Bearer token-owner' },
    body: JSON.stringify({ name: '角色', consent: true, hqVoiceProfileId: 'unknown-voice' }) })).status).toBe(400);
  expect(charactersService.get('invalid-voice-role')).toBeNull();
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
