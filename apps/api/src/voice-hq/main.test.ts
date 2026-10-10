import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { store } from '../store/persistence';
import { charactersService } from '../services/characters';
import { preludeCardsService, VOICE_PRELUDE_ID } from '../services/prelude-cards';
import * as pipeline from '../pipeline/chat-pipeline';
import * as router from '../llm/create-router';
import { clearFlagCache } from '../config/feature-flags';
import { setQuotaForDate, getQuotaForDate } from '../services/users';
import { generateHqReply, type MainInput } from './main';
import { mockSessionsRoute } from '../routes/sessions';
import { mockChatRoute } from '../routes/chat';
import { isPhoneTextModelScope } from '../services/llm-scope';

let input: MainInput;
beforeEach(() => {
  store.__resetForTests();
  store.state().users.one = { id: 'one', token: 'token-one', ageVerified: true, narrativeBoundary: 2,
    ifUnlocked: false, createdAt: new Date().toISOString(), candle: 100, registerGrant: 100, conversationRounds: 0 };
  store.state().tokenIndex['token-one'] = 'one';
  charactersService.upsert({ id: 'test', slug: 'test', name: '测试', rarity: 'free', priceCandle: 0,
    boundaryDefault: 2, description: 'CHARACTER_CORE_SENTINEL' });
  preludeCardsService.upsert({ id: VOICE_PRELUDE_ID, name: 'voice', content: 'LIVE_ONLY_SENTINEL', scope: 'voice' });
  vi.stubEnv('FEATURE_REAL_LLM', 'on'); vi.stubEnv('TOKEN_GUARD_ENABLED', 'off'); clearFlagCache();
  vi.spyOn(router, 'getRouter').mockReturnValue({ hasReady: () => true, getMainModel: () => 'test-main' } as ReturnType<typeof router.getRouter>);
  vi.spyOn(pipeline, 'resolveTemperature').mockResolvedValue(3);
  vi.spyOn(pipeline, 'streamMainLLM').mockImplementation(async function* () {
    yield { chunk: { text: '完整原文。', sentenceEnd: true, glow: false }, actualModel: 'test-main' };
  });
  input = { userId: 'one', sessionId: 'hq_test', characterId: 'test', text: '陪我聊聊', history: [],
    signal: new AbortController().signal, onPrompt: vi.fn() };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); clearFlagCache(); });

it('routes phone HQ text and temperature through phone scope, without changing ordinary voice', async () => {
  store.state().phoneVoiceSessions = { [input.sessionId]: { userId: input.userId, characterId: input.characterId, mode: 'main', context: '' } };
  vi.mocked(pipeline.resolveTemperature).mockImplementationOnce(async () => { expect(isPhoneTextModelScope()).toBe(true); return 3; });
  vi.mocked(pipeline.streamMainLLM).mockImplementationOnce(async function* () {
    expect(isPhoneTextModelScope()).toBe(true);
    yield { chunk: { text: '小手机回复。', sentenceEnd: true, glow: false }, actualModel: 'gemini-3.5-flash-lite' };
  });
  expect((await generateHqReply(input)).model).toBe('gemini-3.5-flash-lite');
  expect(isPhoneTextModelScope()).toBe(false);
});
it('reuses text prompt/main generator, passes full history and writes no other sidecar outputs', async () => {
  input.history = [{ role: 'user', content: '前一轮' }, { role: 'assistant', content: '前一答' }];
  const output = await generateHqReply(input);
  expect(output.text).toBe('完整原文。');
  const prompt = vi.mocked(input.onPrompt).mock.calls[0]![0];
  expect(prompt).toContain('CHARACTER_CORE_SENTINEL'); expect(prompt).not.toContain('LIVE_ONLY_SENTINEL');
  expect(pipeline.resolveTemperature).toHaveBeenCalledTimes(1);
  expect(vi.mocked(pipeline.streamMainLLM).mock.calls[0]![3]).toEqual(input.history);
  expect(store.state().userProfiles).toEqual({}); expect(store.state().contextSummaries).toEqual({});
  expect(store.state().messages.hq_test?.map(m => m.content)).toEqual(['陪我聊聊', '完整原文。']);
  expect(getQuotaForDate('one').freeUsed).toBe(1);
});
it('rejects excessive context without truncation, quota consumption or a main call', async () => {
  vi.stubEnv('VOICE_HQ_CONTEXT_MAX_CHARS', '4000'); input.history = [{ role: 'user', content: '长'.repeat(4100) }];
  await expect(generateHqReply(input)).rejects.toThrow('HQ_CONTEXT_LIMIT');
  expect(pipeline.streamMainLLM).not.toHaveBeenCalled(); expect(getQuotaForDate('one').freeUsed).toBe(0);
});
it('exhausted quota uses a fixed ending without main or quotaEnding generation', async () => {
  setQuotaForDate('one', { freeLimit: 0, bonusLimit: 0 });
  expect((await generateHqReply(input)).model).toBe('quota-notice');
  expect(pipeline.streamMainLLM).not.toHaveBeenCalled(); expect(store.state().messages.hq_test).toBeUndefined();
});
it('HQ sessions never become a text-chat recent session or enter its sidecar pipeline', async () => {
  await generateHqReply(input);
  const headers = { Authorization: 'Bearer token-one', 'Content-Type': 'application/json' };
  expect(await (await mockSessionsRoute.request('/recent', { headers })).json()).toBeNull();
  const response = await mockChatRoute.request('/', { method: 'POST', headers, body: JSON.stringify({
    sessionId: input.sessionId, characterId: 'test', text: 'wrong mode', history: [], round: 2, prevStage: 'daily', userBoundary: 2,
  }) });
  expect(response.status).toBe(409);
  expect(getQuotaForDate('one').freeUsed).toBe(1);
});
it('activates IF from HQ input in the same turn and retains the IF prelude on later turns', async () => {
  store.state().ifCodes = [{ code: 'HQ-TEST-CIPHER', source: 'test', active: true, boundary: 4, temperature: 4 }];
  preludeCardsService.upsert({ id: 'hq-if-test', name: 'IF test', content: 'HQ_IF_PRELUDE_SENTINEL', scope: 'if', priority: 9999 });
  input.text = 'HQ TEST CIPHER';
  await generateHqReply(input);
  expect(store.state().sessions.hq_test).toMatchObject({ ifActive: true, mode: 'if' });
  expect(vi.mocked(pipeline.resolveTemperature).mock.calls[0]![0].ifUnlock).toEqual({ matched: true, ifActive: true, forcedTemperature: 4 });
  expect(vi.mocked(input.onPrompt).mock.calls[0]![0]).toContain('HQ_IF_PRELUDE_SENTINEL');
  input.text = '继续聊';
  await generateHqReply(input);
  expect(vi.mocked(input.onPrompt).mock.calls[1]![0]).toContain('HQ_IF_PRELUDE_SENTINEL');
  // Account unlock persists, while a new HQ session still needs its own activation.
  input.sessionId = 'hq_another';
  await generateHqReply(input);
  expect(vi.mocked(input.onPrompt).mock.calls[2]![0]).not.toContain('HQ_IF_PRELUDE_SENTINEL');
});
