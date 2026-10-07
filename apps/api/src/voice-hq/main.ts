// 共享文字内核：只调用 resolveTemperature 这一项侧袋；不经过 /api/chat 的后处理。
import { effectiveBoundary, judgeStage } from '@yelan/shared';
import { assembleSystemPrompt } from '../prompts/assemble';
import { getGlobalBoundary } from '../pipeline/boundary';
import { ensureChatSession, resolveTemperature, buildSidecarBlock, persistUserMessage, persistAssistantMessage, streamMainLLM, recordTurnCost } from '../pipeline/chat-pipeline';
import { getRouter } from '../llm/create-router';
import { flag } from '../config/feature-flags';
import { getMainReasoningEffort } from '../services/llm-api-inventory';
import { consumeOneRound, getUserById } from '../services/users';
import { charactersService } from '../services/characters';
import { resolveIfUnlockFromText, isSessionIfActive } from '../services/if-unlock';
import { checkTokenBudget } from '../services/token-guard';
import { store } from '../store/persistence';
import { VoiceError } from '../voice/config';
import { rememberVoiceTurn } from '../phone/memory';
import { voiceMemoryContext, voiceMemoryScope } from '../services/voice-memory';

export interface MainInput {
  userId: string; sessionId: string; characterId: string; text: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>; signal: AbortSignal;
  onPrompt: (prompt: string, temperature: number) => void;
}
export interface MainOutput { text: string; model: string; usage?: { inputTokens: number; outputTokens: number } }
export async function generateHqReply(input: MainInput): Promise<MainOutput> {
  const { userId, sessionId, characterId, text, history, signal } = input;
  const character = charactersService.get(characterId), user = getUserById(userId);
  if (!character || !user || !charactersService.canAccess(characterId, userId)) throw new VoiceError('CHARACTER_NOT_FOUND', 404);
  const router = getRouter();
  if (!flag('FEATURE_REAL_LLM') || !router.hasReady()) throw new VoiceError('HQ_MAIN_NOT_CONFIGURED', 503);
  const session = ensureChatSession({ id: sessionId, userId, characterId });
  const round = session.round + 1;
  const ifUnlock = resolveIfUnlockFromText(userId, sessionId, text);
  const ifActive = isSessionIfActive(session);
  const boundary = effectiveBoundary(user.narrativeBoundary, getGlobalBoundary());
  const stage = judgeStage({ round, text, hourLocal: new Date().getHours(), prevStage: session.prevStage });
  const maxChars = Math.min(100_000, Math.max(4000, Number(process.env.VOICE_HQ_CONTEXT_MAX_CHARS) || 48000));
  const historyChars = history.reduce((n, m) => n + m.content.length, text.length);
  if (historyChars > maxChars) throw new VoiceError('HQ_CONTEXT_LIMIT', 409);
  if (!checkTokenBudget(sessionId, historyChars + 2000, { userId }).allowed) throw new VoiceError('HQ_TOKEN_LIMIT', 429);
  signal.throwIfAborted();
  const temperature = await resolveTemperature({ sessionId, characterName: character.name,
    characterDescription: character.description || '', styleTags: character.styleTags ?? [], userInput: text,
    boundary, stage, round, ifUnlock });
  const memoryScope = voiceMemoryScope(userId, characterId, sessionId, ifActive);
  const sharedMemory = voiceMemoryContext(userId, characterId, sessionId, memoryScope);
  const prompt = assembleSystemPrompt({ characterId, stage, boundary, ifActive,
    atmosphereBlock: buildSidecarBlock(temperature, sharedMemory, undefined) });
  if (historyChars + prompt.length > maxChars) throw new VoiceError('HQ_CONTEXT_LIMIT', 409);
  if (!consumeOneRound(userId)) return { text: '今天的对话额度已用完，我们下次再聊。', model: 'quota-notice' };
  input.onPrompt(prompt, temperature);
  persistUserMessage(sessionId, text); session.round = round; session.prevStage = stage; store.save();
  let reply = '', usage: MainOutput['usage'], provider: string | undefined, model = router.getMainModel() ?? '';
  for await (const result of streamMainLLM(true, stage, prompt, history, text, getMainReasoningEffort(ifActive ? 'cipher' : 'normal'), signal)) {
    signal.throwIfAborted();
    if (result.chunk) reply += result.chunk.text;
    if (result.providerUsage) usage = result.providerUsage;
    if (result.actualModel) model = result.actualModel;
    if (result.actualProviderId) provider = result.actualProviderId;
  }
  if (!reply.trim()) throw new VoiceError('HQ_MAIN_EMPTY', 502);
  persistAssistantMessage(sessionId, reply);
  const messageId = store.state().messages[sessionId]?.at(-1)?.id;
  if (messageId) rememberVoiceTurn({ userId, characterId, id: messageId,
    inputText: text, outputText: reply, mode: memoryScope.mode, branchId: memoryScope.branchId });
  recordTurnCost({ assistantBuffer: reply, providerUsage: usage ?? null, body: { text, history },
    sessionId, modelId: model, actualProviderId: provider });
  return { text: reply, model, usage };
}
