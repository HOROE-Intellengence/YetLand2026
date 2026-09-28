// SSE chat - real LLM + sidecar AI integration.
// User message -> quota -> temperature (mode by TEMPERATURE_OPTIMISTIC policy)
//   -> prompt assembly -> LLM -> structurer.
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { zValidator } from '@hono/zod-validator';
import { ChatRequestSchema, judgeStage, effectiveBoundary } from '@yelan/shared';
import type { ChatStreamEvent } from '@yelan/shared';
import { getRouter } from '../llm/create-router';
import { getGlobalBoundary } from '../pipeline/boundary';
import { shouldInjectMemory } from '../pipeline/memory-gate';
import { assembleSystemPrompt } from '../prompts/assemble';
import { softAuth } from '../middleware/auth';
import { consumeOneRound, getQuotaToday } from '../services/users';
import { charactersService } from '../services/characters';
import { resolveIfUnlockFromText, isSessionIfActive } from '../services/if-unlock';
import { store } from '../store/persistence';
import { flag } from '../config/feature-flags';
import { checkTokenBudget, estimateTokens } from '../services/token-guard';
import { validationHook } from '../middleware/validation';
import { randomUUID } from 'node:crypto';
import {
  ensureChatSession,
  resolveTemperature,
  buildSidecarBlock,
  persistUserMessage,
  persistAssistantMessage,
  structureOrFallback,
  recordTurnCost,
  runAfterDoneSidecars,
  handleQuotaExhaustedSSE,
  streamMainLLM,
} from '../pipeline/chat-pipeline';
import { fallbackStructure, OUTPUT_STRUCTURER_TIMEOUT_MS } from '../sidecar-ai/output-structurer';
import { getUserProfile } from '../sidecar-ai/preference-recorder';
import { getSummary, getExpiredTurns } from '../sidecar-ai/context-compressor';
import { getMainReasoningEffort } from '../services/llm-api-inventory';

export const mockChatRoute = new Hono();
export const STRUCTURER_BUDGET_MS = OUTPUT_STRUCTURER_TIMEOUT_MS + 500;
const STRUCTURER_BUDGET_TIMEOUT = Symbol('STRUCTURER_BUDGET_TIMEOUT');

mockChatRoute.use('*', softAuth());

mockChatRoute.post(
  '/',
  zValidator('json', ChatRequestSchema, validationHook),
  async (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');

    const character = charactersService.get(body.characterId);
    if (!character) return c.json({ code: 'CHARACTER_NOT_FOUND', message: 'character not found' }, 400);
    // 越权护栏：私有的用户自定义卡只有本人能进对话（否则可拿他人私有卡内容跑 prompt）。
    if (!charactersService.canAccess(body.characterId, userId)) {
      return c.json({ code: 'CHARACTER_NOT_FOUND', message: 'character not found' }, 400);
    }

    ensureChatSession({ id: body.sessionId, userId, characterId: body.characterId });
    const ifUnlock = resolveIfUnlockFromText(userId, body.sessionId, body.text);
    // 命中暗号时 resolveIfUnlockFromText 内部已把本 session 置为 mode='if'。
    // IF 前置卡只认 session 级状态：user 级永久解锁不污染其它会话/角色。
    const sessionIfActive = isSessionIfActive(store.state().sessions[body.sessionId]);

    if (!consumeOneRound(userId)) {
      return streamSSE(c, async (stream) => {
        const requestId = (c.get('requestId') as string) || `req_${randomUUID().slice(0, 12)}`;
        const writeEv = (ev: ChatStreamEvent) => stream.writeSSE({ data: JSON.stringify({ ...ev, requestId }) });
        for await (const ev of handleQuotaExhaustedSSE(character, sessionIfActive, body)) {
          await writeEv(ev);
        }
      });
    }

    const boundary = effectiveBoundary(body.userBoundary, getGlobalBoundary());
    const stage = judgeStage({
      round: body.round,
      text: body.text,
      hourLocal: new Date().getHours(),
      prevStage: body.prevStage,
    });

    const memoryDecision = shouldInjectMemory({
      round: body.round,
      lastMemoryRound: store.state().sessions[body.sessionId]?.lastMemoryRound ?? null,
      prevStage: body.prevStage,
      curStage: stage,
      userText: body.text,
    });
    console.log(
      `[memory-gate] sessionId=${body.sessionId} round=${body.round} ` +
      `decision=${memoryDecision.inject} reason=${memoryDecision.reason}`,
    );
    const throttleEnabled = flag('FEATURE_MEMORY_THROTTLE');
    const skipMemory = throttleEnabled && !memoryDecision.inject;

    const profile = getUserProfile(userId);
    const summary = getSummary(body.sessionId);
    const { recent: recentHistory } = getExpiredTurns(
      body.history.map((m) => ({ role: m.role, content: m.content })),
      15,
    );
    const effectiveProfile = skipMemory ? null : profile;
    const effectiveSummary = skipMemory ? null : summary;
    const effectiveRecall = skipMemory ? undefined : body.recall;

    persistUserMessage(body.sessionId, body.text);
    const s = store.state();
    if (s.sessions[body.sessionId]) {
      s.sessions[body.sessionId]!.round = body.round;
      s.sessions[body.sessionId]!.prevStage = stage;
      if (throttleEnabled && memoryDecision.inject) {
        s.sessions[body.sessionId]!.lastMemoryRound = body.round;
      }
    }

    return streamSSE(c, async (stream) => {
      const requestId = (c.get('requestId') as string) || `req_${randomUUID().slice(0, 12)}`;
      const writeEv = (ev: ChatStreamEvent) => stream.writeSSE({ data: JSON.stringify({ ...ev, requestId }) });

      // 心跳机制：每 20 秒发送一次注释保持连接活跃
      const heartbeatInterval = setInterval(() => {
        try {
          stream.writeSSE({ comment: 'keepalive' });
        } catch (e) {
          // 连接已断开，清除定时器
          clearInterval(heartbeatInterval);
        }
      }, 20000);

      try {
        const router = getRouter();
      const realLlmEnabled = flag('FEATURE_REAL_LLM');
      const estimatedTokens = estimateTokens(body.text, body.history.length);
      const tokenBudget = checkTokenBudget(body.sessionId, estimatedTokens, { requestId, userId });
      const useReal = realLlmEnabled && router.hasReady() && tokenBudget.allowed;

      await writeEv({
        kind: 'meta',
        stage,
        boundary,
        ifActive: sessionIfActive,
        requestId,
        llmMode: useReal ? 'real' : tokenBudget.allowed ? 'mock' : 'fallback',
        tokenGuard: tokenBudget.allowed ? 'ok' : tokenBudget.reason,
        mainProviderId: router.mainProviderId ?? undefined,
        mainModel: router.getMainModel() ?? undefined,
      });

      // 温度：模式由 TEMPERATURE_OPTIMISTIC 策略决定（乐观异步=不阻塞首字 / 同步阻塞=实时反应本轮）。
      const temperature = await resolveTemperature({
        sessionId: body.sessionId,
        characterName: character.name,
        characterDescription: character.description || 'standard',
        styleTags: character.styleTags ?? [],
        userInput: body.text,
        boundary,
        stage,
        round: body.round,
        ifUnlock,
      });
      await writeEv({ kind: 'atmosphere', temperature });

      // 温度块作为 {{atmosphere_block}} 槽位注入主 prompt（旧模板无槽位时由 render 追加到尾部，行为不变）。
      // 装配放在温度算出之后，温度才能进模板。
      const sidecarBlock = buildSidecarBlock(temperature, effectiveProfile ?? undefined, effectiveSummary ?? undefined);
      const system = assembleSystemPrompt({
        characterId: body.characterId,
        stage,
        boundary,
        ifActive: sessionIfActive,
        recall: effectiveRecall,
        cutoffWarning: body.cutoffWarning,
        atmosphereBlock: sidecarBlock,
      });
      if (process.env.DEBUG_SYSTEM_PROMPT === 'on') {
        console.log(`[debug-system-prompt] sessionId=${body.sessionId} round=${body.round} length=${system.length}\n----BEGIN----\n${system}\n----END----`);
      }

      let assistantBuffer = '';
      let providerUsage: { inputTokens: number; outputTokens: number } | null = null;
      let actualProviderId: string | undefined;
      let actualModel: string | undefined;

      // 主 AI 推理档位：暗号(IF 解锁)场景与普通场景分档，后台可调。
      const reasoningEffort = getMainReasoningEffort(sessionIfActive ? 'cipher' : 'normal');

      try {
        for await (const result of streamMainLLM(useReal, stage, system, recentHistory, body.text, reasoningEffort)) {
          if (result.chunk) {
            assistantBuffer += result.chunk.text;
            await writeEv({ kind: 'chunk', text: result.chunk.text, sentenceEnd: result.chunk.sentenceEnd, glow: result.chunk.glow });
          }
          if (result.providerUsage) providerUsage = result.providerUsage;
          if (result.actualProviderId) { actualProviderId = result.actualProviderId; actualModel = result.actualModel; }
        }

        if (assistantBuffer) {
          persistAssistantMessage(body.sessionId, assistantBuffer);

          const fallback = fallbackStructure(assistantBuffer);
          const aiPartsPromise = structureOrFallback(assistantBuffer);

          const raced = await Promise.race([
            aiPartsPromise,
            new Promise<typeof STRUCTURER_BUDGET_TIMEOUT>((resolve) => setTimeout(() => resolve(STRUCTURER_BUDGET_TIMEOUT), STRUCTURER_BUDGET_MS)),
          ]);

          if (raced !== STRUCTURER_BUDGET_TIMEOUT && raced.result) {
            await writeEv({ kind: 'structured', parts: raced.result.parts, rawText: assistantBuffer, source: 'sidecar' });
          } else {
            const degradeReason = raced === STRUCTURER_BUDGET_TIMEOUT ? 'budget-timeout' : raced.reason;
            await writeEv({ kind: 'structured', parts: fallback.parts, rawText: assistantBuffer, source: 'fallback', degradeReason });
            if (raced === STRUCTURER_BUDGET_TIMEOUT) {
              console.count('[sidecar] outputStructurer budget discard');
              void aiPartsPromise.then((outcome) => {
                if (outcome.result) {
                  console.warn(`[sidecar] outputStructurer completed after budget (${STRUCTURER_BUDGET_MS}ms), result discarded`);
                }
              }).catch(() => {});
            }
          }

          recordTurnCost({
            assistantBuffer, providerUsage, body, sessionId: body.sessionId,
            modelId: actualModel ?? router.getMainModel() ?? '',
            actualProviderId: actualProviderId ?? router.mainProviderId ?? undefined,
          });
        }

        await writeEv({ kind: 'done' });
      } catch (e) {
        console.warn('[chat] error:', (e as Error).message);
        await writeEv({ kind: 'error', code: 'LLM_FAILED', message: (e as Error).message });
        await writeEv({ kind: 'done' });
      } finally {
        clearInterval(heartbeatInterval);
      }

      runAfterDoneSidecars(userId, body.characterId, body.sessionId);
      void getQuotaToday(userId);
    });
  },
);
