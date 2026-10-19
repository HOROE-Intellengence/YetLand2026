import { it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAdminPhoneChatLogsRoute } from './phone-chat-logs';
import { PhoneChatLogs } from '../../phone/chat-logs';
import { store } from '../../store/persistence';
import { charactersService } from '../../services/characters';
import { PhoneChatLogDetailSchema, PhoneChatLogsPageSchema } from '@yelan/shared';
let root: string, logs: PhoneChatLogs;
const headers = { Authorization: 'Bearer logs-test-admin' };
beforeEach(() => {
  vi.stubEnv('ADMIN_TOKEN', 'logs-test-admin'); store.__resetForTests();
  root = mkdtempSync(join(tmpdir(), 'phone-log-route-')); logs = new PhoneChatLogs(root);
  store.state().users.one = { id: 'one', name: '林深', nickname: '小林', token: 'secret-token', passwordHash: 'secret-hash',
    ageVerified: true, narrativeBoundary: 2, ifUnlocked: false, createdAt: '2026-10-01', candle: 0, registerGrant: 0, conversationRounds: 0 };
  store.state().users.two = { ...store.state().users.one!, id: 'two', nickname: undefined, name: '晚风' };
  charactersService.upsert({id:'role',slug:'role',name:'沈砚之',rarity:'free',priceCandle:0,boundaryDefault:2});
  logs.start({id:'one-call',userId:'one',characterId:'role',model:'test',messages:[{role:'user',content:'今天睡不着'}]});
  logs.finish('one-call','complete',200,200,null,JSON.stringify({choices:[{message:{role:'assistant',content:'我在这里'}}]}),false);
  logs.start({id:'two-call',userId:'two',characterId:'role',model:'test',messages:[]});
  logs.finish('two-call','failed',100,502,'UPSTREAM','',false);
});
afterEach(() => { logs.db.close(); rmSync(root,{recursive:true,force:true}); vi.unstubAllEnvs(); });
it('restricts list and detail to admins, uses no-store and rejects invalid filters', async () => {
  const app = createAdminPhoneChatLogsRoute(() => logs);
  for (const path of ['/', '/one-call']) for (const token of ['', 'Bearer ordinary']) {
    expect((await app.request(path, { headers: { Authorization: token } })).status).toBe(401);
  }
  const response = await app.request('/', { headers });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  for (const query of ['page=-1','page=1.5','status=unknown',`user=${'a'.repeat(129)}`]) {
    expect((await app.request(`/?${query}`, { headers })).status).toBe(400);
  }
});
it('enriches both list and detail with user and role names without exposing account secrets or full prompts', async () => {
  const app = createAdminPhoneChatLogsRoute(() => logs);
  const data = PhoneChatLogsPageSchema.parse(await (await app.request('/', { headers })).json());
  expect(data.items.find(row=>row.userId==='one')).toMatchObject({userName:'小林',characterName:'沈砚之',inputPreview:'今天睡不着',outputPreview:'我在这里'});
  expect(data.items.find(row=>row.userId==='two')?.userName).toBe('晚风');
  expect(JSON.stringify(data)).not.toMatch(/secret-token|secret-hash|"request"|"response"/);
  const detail = PhoneChatLogDetailSchema.parse(await (await app.request('/one-call', { headers })).json());
  expect(detail).toMatchObject({userName:'小林',characterName:'沈砚之'});
  expect(detail.request).toContain('今天睡不着');
  store.state().users.one!.nickname='新昵称';
  expect(await (await app.request('/one-call', { headers })).json()).toMatchObject({userName:'新昵称'});
});
it('searches nickname, name, user ID and role name before pagination and combines status filters', async () => {
  const app = createAdminPhoneChatLogsRoute(() => logs);
  const list = async (params: Record<string,string>) => PhoneChatLogsPageSchema.parse(await (await app.request(`/?${new URLSearchParams(params)}`,{headers})).json());
  for (const user of ['小林','林深','one']) expect((await list({user})).items.map(row=>row.id)).toEqual(['one-call']);
  expect((await list({character:'沈砚',status:'failed'})).items.map(row=>row.id)).toEqual(['two-call']);
  expect((await list({user:'不存在'})).total).toBe(0);
  expect((await list({userId:'two',characterId:'role',branchId:''})).total).toBe(1);
  expect((await list({userId:'two',branchId:'other'})).total).toBe(0);
});
it('keeps historical records readable when their user or character no longer exists', async () => {
  const app = createAdminPhoneChatLogsRoute(() => logs);
  delete store.state().users.one; delete store.state().characters.role;
  const response=await app.request('/one-call',{headers});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({userName:'未知用户',userId:'one',characterName:'role'});
  expect((await app.request('/missing',{headers})).status).toBe(404);
});
