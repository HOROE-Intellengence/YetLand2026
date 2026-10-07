import type { ChatStreamEvent, OutputStructurerResult, Stage, Character, RecallPayload, Boundary } from '@yelan/shared';
import { effectiveBoundary, judgeStage, isSentenceEnd, maybeGlow } from '@yelan/shared';
import { getRouter } from '../llm/create-router';
import { getGlobalBoundary } from './boundary';
import { assembleSystemPrompt } from '../prompts/assemble';
import { consumeOneRound } from '../services/users';
import { resolveIfUnlockFromText } from '../services/if-unlock';
import { store, type SessionRow } from '../store/persistence';
import { mockChatStream } from '../stream/mock-sse';
import { sidecarReady } from '../sidecar-ai/client';
import { judgeAtmosphere, getCurrentTemperature, getTemperatureLog, recordTemperature } from '../sidecar-ai/atmosphere-judge';
import { structureOutput, fallbackStructure } from '../sidecar-ai/output-structurer';
import { bumpInputCounter, shouldRecordPreference, recordPreference, getUserProfile } from '../sidecar-ai/preference-recorder';
import { generateQuotaEnding, fallbackQuotaEnding } from '../sidecar-ai/quota-ending';
import {
  compressContext,
  setSummary,
  getSummary,
  getExpiredTurns,
  getCompressedUntilMessageId,
  getUncompressedExpiredMessages,
} from '../sidecar-ai/context-compressor';
import { orderSidecars } from '../sidecar-ai/orchestrator';
import { flag } from '../config/feature-flags';
import { checkTokenBudget, recordTokenUsage, estimateTokens } from '../services/token-guard';
import { consolidatePreferences, shouldConsolidatePreferences } from '../services/memories';
import { policyService } from '../services/policy';
import { getProviderPrice, estimateInputTokens } from '@yelan/llm';
import type { SanitizerStats, ReasoningEffort } from '@yelan/llm';
import { randomUUID } from 'node:crypto';

export const EMPTY_REPLY_FALLBACK = '……（我走神了一下）你刚才说什么，再同我说一遍好吗？';

// 1-5 全档位的「拿到温度该怎么演」指引。口径与 atmosphereJudge 的 ATMOSPHERE_PROMPT_V2 对齐：
// 温度=本轮当前情绪速度（非历史累计高度），是这一轮演到几分、不是必须升温；
// 边界=内容可写上限、不是升温指令。中间档（3）也给出明确指引，避免主 AI 无契约可循。
const TEMPERATURE_GUIDANCE: Record<number, string> = {
  1: '冷淡疏离：保持礼貌距离，克制主动，不堆叠亲近信号。台词可有可无，不必为对话而对话。',
  2: '微凉克制：有回应但留白多于贴近，不主动升温。台词简短即可，不强求。',
  3: '暧昧升温：默认档，可有暧昧张力与试探，明示与留白并存，但不越过边界。叙事中宜穿插角色直接台词（用「」标出），不要整段只剩旁白与动作。',
  4: '明显亲近：情感投入与靠近更外显，写法仍受边界约束。多让角色开口（「」直接引语），台词与动作、心理交错推进。',
  5: '亲密无间：可写依恋、靠近、脆弱暴露，贴到边界允许的上限为止。以角色直接台词（「」）承载情感，避免大段旁白稀释临场感。',
};

function temperatureGuidance(temperature: number): string {
  const level = Math.min(5, Math.max(1, Math.round(temperature)));
  return TEMPERATURE_GUIDANCE[level]!;
}

export function classifyEmptyReply(stats: SanitizerStats | undefined): string {
  if (!stats) return 'no-stats';
  if (stats.endedInsideThink) return 'quarantine-empty';
  if (stats.enteredThink) return 'think-only-empty';
  return 'provider-empty';
}

export function ensureChatSession(args: {
  id: string;
  userId: string;
  characterId: string;
}): SessionRow {
  const s = store.state();
  const existing = s.sessions[args.id];
  const now = new Date().toISOString();
  if (existing) {
    existing.userId = args.userId;
    existing.characterId = args.characterId;
    existing.updatedAt = now;
    return existing;
  }

  const row: SessionRow = {
    id: args.id,
    userId: args.userId,
    characterId: args.characterId,
    mode: 'main',
    ifActive: false,
    round: 0,
    prevStage: 'daily',
    createdAt: now,
    updatedAt: now,
  };
  s.sessions[args.id] = row;
  store.save();
  return row;
}

export interface TemperatureInput {
  sessionId: string;
  characterName: string;
  characterDescription: string;
  styleTags: string[];
  userInput: string;
  boundary: Boundary;
  stage: Stage;
  round: number;
  ifUnlock: ReturnType<typeof resolveIfUnlockFromText>;
}

function fallbackTemperature(sessionId: string): number {
  return getCurrentTemperature(sessionId);
}

export function classifySidecarFailure(error: string | undefined): 'no key' | 'timeout' | 'schema invalid' | 'other' {
  const normalized = (error ?? '').toLowerCase();
  if (normalized.includes('no sidecar api key') || normalized.includes('no key')) return 'no key';
  if (normalized.includes('timeout') || normalized.includes('abort')) return 'timeout';
  if (normalized.includes('schema validation') || normalized.includes('schema invalid')) return 'schema invalid';
  return 'other';
}

function logSidecarDegrade(task: string, error: string | undefined): void {
  console.warn(`[sidecar] ${task} degraded reason=${classifySidecarFailure(error)} detail=${error ?? 'unknown'}`);
}

/**
 * 解析本轮温度。模式由后台「策略」面板的 TEMPERATURE_OPTIMISTIC 运行期切换（默认乐观）：
 *  - 乐观异步：本轮立即用上一轮记录值开流、不阻塞首字，judge 异步刷新供下一轮（温度晚一轮反应）。
 *  - 同步阻塞：主 AI 回复前 await judge，温度实时反应本轮输入，但每轮首字多等一次侧袋 LLM。
 * 暗号瞬时升温在两种模式下都同步作用于本轮。
 */
export async function resolveTemperature(input: TemperatureInput): Promise<number> {
  // 暗号瞬时升温：命中暗号当轮（matched）若该暗号配了目标温度，直接跳到该温度。
  // 仅作用本轮、不留地板 —— 下一轮 matched=false，温度完全交还 judge。
  if (input.ifUnlock.matched && input.ifUnlock.forcedTemperature != null) {
    const forced = input.ifUnlock.forcedTemperature;
    recordTemperature(input.sessionId, forced);
    return forced;
  }

  if (policyService.get('TEMPERATURE_OPTIMISTIC', true)) {
    // 乐观：judge 异步刷新供下一轮（成功时内部 recordTemperature），本轮立即用上一轮记录值。
    void runAtmosphereJudge(input);
    return fallbackTemperature(input.sessionId);
  }

  // 同步：阻塞等 judge，命中即用判定值；降级则沿用上一轮并记录。
  const judged = await runAtmosphereJudge(input);
  if (judged != null) return judged;
  const temperature = fallbackTemperature(input.sessionId);
  recordTemperature(input.sessionId, temperature);
  return temperature;
}

/**
 * 执行 atmosphereJudge：返回判定温度（成功时 judgeAtmosphere 内部已 recordTemperature 写入日志）；
 * disabled / 无 key / 超时 / 校验失败一律返回 null，由调用方决定降级。
 * 乐观模式 void 调用弃返回值（异步刷新）；同步模式 await 取返回值。
 */
async function runAtmosphereJudge(input: TemperatureInput): Promise<number | null> {
  const preMainSidecars = orderSidecars(['atmosphereJudge']);
  if (preMainSidecars.length === 0) {
    console.warn('[sidecar] atmosphereJudge skipped reason=disabled');
    return null;
  }
  if (!sidecarReady('atmosphereJudge')) {
    logSidecarDegrade('atmosphereJudge', 'no sidecar API key configured');
    return null;
  }
  try {
    const recentTemps = getTemperatureLog(input.sessionId);
    const recentMsgs = (store.state().messages[input.sessionId] ?? []).slice(-8);
    const recentConv = recentMsgs.map((m) => `${m.role}: ${m.content}`).join('\n');

    const atmoResult = await judgeAtmosphere(
      {
        characterName: input.characterName,
        characterPersonality: input.characterDescription || '标准',
        boundary: input.boundary,
        stage: input.stage,
        round: input.round,
        ifActive: input.ifUnlock.ifActive,
        recentTemperatures: recentTemps.slice(-5),
        recentConversation: recentConv,
        userInput: input.userInput,
        warmingRule: input.styleTags.includes('restrained') ? '慢热、克制、需要明显主动信号才升温' : undefined,
        codeMatched: input.ifUnlock.matched,
        maxTemperature: 5,
      },
      input.sessionId,
    );
    if (atmoResult.ok && atmoResult.data) return atmoResult.data.temperature;
    logSidecarDegrade('atmosphereJudge', atmoResult.error);
    return null;
  } catch (e) {
    logSidecarDegrade('atmosphereJudge', (e as Error).message);
    return null;
  }
}

export function buildSidecarBlock(temperature: number, profile: string | undefined, summary: string | undefined): string {
  return [
    `[当前温度：${temperature}]`,
    '[温度契约：温度是本轮当前情绪速度，不是历史高度——上一轮高温不代表本轮继续高温；边界是内容可写上限，不是升温指令——低边界时即使温度偏高也要克制写法]',
    `[温度演法：${temperatureGuidance(temperature)}]`,
    profile ? `[用户画像]\n${profile.slice(0, 500)}` : '',
    summary ? `[旧对话概要]\n${summary.slice(0, 500)}` : '',
  ].filter(Boolean).join('\n');
}

export function persistUserMessage(sessionId: string, text: string): void {
  const s = store.state();
  const session = s.sessions[sessionId];
  if (session) {
    session.updatedAt = new Date().toISOString();
    const user = s.users[session.userId];
    if (user) user.conversationRounds = (user.conversationRounds ?? 0) + 1;
  }
  const sessionMessages = (s.messages[sessionId] ??= []);
  sessionMessages.push({
    id: `msg_${randomUUID().slice(0, 8)}`,
    sessionId,
    role: 'user',
    content: text,
    createdAt: new Date().toISOString(),
  });
  store.save();
}

export function persistAssistantMessage(sessionId: string, text: string): void {
  const s = store.state();
  s.messages[sessionId]!.push({
    id: `msg_${randomUUID().slice(0, 8)}`,
    sessionId,
    role: 'assistant',
    content: text,
    createdAt: new Date().toISOString(),
  });
  store.save();
}

export interface StructureOutcome {
  result: OutputStructurerResult | null;
  reason: string; // '' 表示侧袋成功；否则是降级原因（disabled/no key/timeout/schema invalid/other）
}

export async function structureOrFallback(text: string): Promise<StructureOutcome> {
  const postMainSidecars = orderSidecars(['outputStructurer']);
  if (postMainSidecars.length === 0) {
    console.warn('[sidecar] outputStructurer skipped reason=disabled');
    return { result: null, reason: 'disabled' };
  }
  if (!sidecarReady('outputStructurer')) {
    logSidecarDegrade('outputStructurer', 'no sidecar API key configured');
    return { result: null, reason: 'no key' };
  }
  try {
    const structured = await structureOutput(text);
    if (structured.ok && structured.data) return { result: structured.data, reason: '' };
    logSidecarDegrade('outputStructurer', structured.error);
    return { result: null, reason: classifySidecarFailure(structured.error) };
  } catch (e) {
    logSidecarDegrade('outputStructurer', (e as Error).message);
    return { result: null, reason: classifySidecarFailure((e as Error).message) };
  }
}

export function recordTurnCost(params: {
  assistantBuffer: string;
  providerUsage: { inputTokens: number; outputTokens: number } | null;
  body: { text: string; history: Array<{ content: string }> };
  sessionId: string;
  modelId: string;
  actualProviderId?: string;
}): void {
  let inputTokens: number;
  let outputTokens: number;
  if (params.providerUsage) {
    inputTokens = params.providerUsage.inputTokens;
    outputTokens = params.providerUsage.outputTokens;
  } else {
    inputTokens = estimateInputTokens(params.body);
    outputTokens = Math.ceil(params.assistantBuffer.length / 2);
  }
  const totalTokens = inputTokens + outputTokens;
  const price = getProviderPrice(params.modelId || undefined);
  const cost = +((inputTokens * price.input + outputTokens * price.output)).toFixed(6);

  if (params.actualProviderId) {
    console.log(`[cost] turn cost: provider=${params.actualProviderId} model=${params.modelId} tokens=${totalTokens} cost=$${cost}`);
  }

  const s = store.state();
  const today = new Date().toISOString().slice(0, 10);
  const existing = s.costsDaily.find((r) => r.date === today);
  if (existing) {
    existing.calls += 1;
    existing.tokens += totalTokens;
    existing.cost += cost;
  } else {
    s.costsDaily.push({ date: today, cost, tokens: totalTokens, calls: 1 });
  }
  recordTokenUsage(params.sessionId, totalTokens);
  store.save();
}

export function runAfterDoneSidecars(userId: string, characterId: string, sessionId: string): void {
  bumpInputCounter(userId);
  const afterDoneSidecars = orderSidecars(['preferenceRecorder', 'contextCompressor']);
  let preferenceWork: Promise<unknown> | null = null;

  const maybeConsolidate = () => {
    if (!shouldConsolidatePreferences(userId)) return;
    const stats = consolidatePreferences(userId);
    if (stats.tombstoned > 0 || stats.changelogPruned > 0) {
      console.log(`[memory] preference consolidation user=${userId} active=${stats.activeBefore}->${stats.activeAfter} tombstoned=${stats.tombstoned} changelogPruned=${stats.changelogPruned}`);
    }
  };

  for (const sc of afterDoneSidecars) {
    if (sc === 'preferenceRecorder' && shouldRecordPreference(userId)) {
      const s = store.state();
      const recentForPref = (s.messages[sessionId] ?? [])
        .slice(-20)
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');
      if (sidecarReady('preferenceRecorder')) {
        preferenceWork = recordPreference(userId, characterId, recentForPref, sessionId).catch((e) => {
          console.warn('[sidecar] preferenceRecorder failed:', (e as Error).message);
        });
      }
    }
    if (sc === 'contextCompressor') {
      const s = store.state();
      const allMsgs = s.messages[sessionId] ?? [];
      const { expired } = getExpiredTurns(allMsgs, 15);
      if (expired.length > 0 && sidecarReady('contextCompressor')) {
        const currentSummary = getSummary(sessionId);
        const compressedUntilId = getCompressedUntilMessageId(sessionId);
        const nextExpired = getUncompressedExpiredMessages(expired, compressedUntilId);
        const lastExpired = nextExpired.at(-1);
        if (!lastExpired) continue;
        const convText = nextExpired.map((m) => `${m.role}: ${m.content}`).join('\n');
        compressContext(convText, currentSummary).then((result) => {
          if (result.ok && result.data) {
            setSummary(sessionId, result.data.summary, lastExpired.id);
          }
        }).catch((e) => {
          console.warn('[sidecar] contextCompressor failed:', (e as Error).message);
        });
      }
    }
  }

  if (preferenceWork) void preferenceWork.finally(maybeConsolidate);
  else maybeConsolidate();
}

/** 配额耗尽时的 SSE 收束流 */
export async function* handleQuotaExhaustedSSE(
  character: Character,
  ifActive: boolean,
  body: {
    characterId: string;
    sessionId: string;
    userBoundary: 1 | 2 | 3 | 4 | 5;
    recall?: RecallPayload;
    text: string;
    history: Array<{ role: string; content: string }>;
  },
): AsyncGenerator<ChatStreamEvent> {
  let closingInstruction = fallbackQuotaEnding().closingInstruction;
  const quotaSidecars = orderSidecars(['quotaEnding']);
  if (quotaSidecars.length > 0 && sidecarReady('quotaEnding')) {
    try {
      const temp = getCurrentTemperature(body.sessionId);
      const recent = (store.state().messages[body.sessionId] ?? [])
        .slice(-6)
        .map((m) => `${m.role}: ${m.content}`)
        .join('\n');
      const ending = await generateQuotaEnding(character.name, temp, recent);
      if (ending.ok) closingInstruction = ending.data!.closingInstruction;
    } catch (e) {
      console.warn('[sidecar] quotaEnding failed:', (e as Error).message);
    }
  }

  yield { kind: 'cutoff', reason: 'quota' };

  const router = getRouter();
  let buf = '';
  if (router.hasReady()) {
    const system = assembleSystemPrompt({
      characterId: body.characterId,
      stage: 'end',
      boundary: effectiveBoundary(body.userBoundary, getGlobalBoundary()),
      ifActive,
      recall: body.recall,
      cutoffWarning: true,
    });
    try {
      for await (const chunk of router.stream('end', {
        model: '',
        messages: [
          { role: 'system', content: `${system}\n\n${closingInstruction}` },
          ...body.history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
          { role: 'user', content: body.text },
        ],
      })) {
        if (chunk.text) buf += chunk.text;
      }
    } catch { /* fall through */ }
  }
  if (!buf) buf = '夜色深了。先到这里吧。';

  const outcome = await structureOrFallback(buf);
  if (outcome.result) {
    yield { kind: 'structured', parts: outcome.result.parts, rawText: buf, source: 'sidecar' };
  } else {
    const fallback = fallbackStructure(buf);
    yield { kind: 'structured', parts: fallback.parts, rawText: buf, source: 'fallback', degradeReason: outcome.reason };
  }
  yield { kind: 'done' };
}

export interface StreamChunk {
  text: string;
  sentenceEnd: boolean;
  glow: boolean;
}

export interface StreamResult {
  done: boolean;
  error?: string;
  providerUsage?: { inputTokens: number; outputTokens: number };
  sanitizerStats?: SanitizerStats;
}

/** 主 LLM 流式输出，含空回复兜底 */
export async function* streamMainLLM(
  useReal: boolean,
  stage: Stage,
  system: string,
  recentHistory: Array<{ role: string; content: string }>,
  bodyText: string,
  reasoningEffort?: ReasoningEffort,
  signal?: AbortSignal,
): AsyncGenerator<{ chunk?: StreamChunk; providerUsage?: { inputTokens: number; outputTokens: number }; sanitizerStats?: SanitizerStats; actualProviderId?: string; actualModel?: string }> {
  let assistantBuffer = '';
  let sentenceBuffer = '';
  let providerUsage: { inputTokens: number; outputTokens: number } | null = null;
  let sanitizerStats: SanitizerStats | undefined;
  let actualProviderId: string | undefined;
  let actualModel: string | undefined;

  if (useReal) {
    const router = getRouter();
    const messages = [
      { role: 'system' as const, content: system },
      ...recentHistory.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      { role: 'user' as const, content: bodyText },
    ];
    for await (const chunk of router.stream(stage, { model: '', messages, reasoningEffort }, signal, (st) => {
      sanitizerStats = st;
    })) {
      if (chunk.providerId) { actualProviderId = chunk.providerId; actualModel = chunk.model; }
      if (chunk.text) {
        assistantBuffer += chunk.text;
        sentenceBuffer += chunk.text;
        const sEnd = isSentenceEnd(sentenceBuffer);
        yield { chunk: { text: chunk.text, sentenceEnd: sEnd, glow: sEnd ? maybeGlow(sentenceBuffer) : false } };
        if (sEnd) sentenceBuffer = '';
      }
      if (chunk.usage) providerUsage = chunk.usage;
    }

    yield { sanitizerStats };

    if (!assistantBuffer.trim()) {
      const cause = classifyEmptyReply(sanitizerStats);
      console.warn(`[chat] empty assistant reply (${cause})`);
      yield { chunk: { text: EMPTY_REPLY_FALLBACK, sentenceEnd: true, glow: false } };
    } else if (sanitizerStats?.endedInsideThink) {
      console.warn('[chat] reply truncated by unclosed think tag');
    }

    if (providerUsage) yield { providerUsage };
    if (actualProviderId) yield { actualProviderId, actualModel };
  } else {
    for await (const ev of mockChatStream()) {
      if (ev.kind === 'meta') continue;
      if (ev.kind === 'chunk') {
        assistantBuffer += (ev as { text?: string }).text ?? '';
      }
      if (ev.kind === 'chunk') {
        const chunkEv = ev as { kind: 'chunk'; text: string; sentenceEnd?: boolean; glow?: boolean };
        yield { chunk: { text: chunkEv.text, sentenceEnd: chunkEv.sentenceEnd ?? false, glow: chunkEv.glow ?? false } };
      }
    }
  }
}
