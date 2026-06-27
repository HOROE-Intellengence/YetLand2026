import type { Env } from '../types/bindings';
import type { ChatRequest, ChatStreamEvent } from '@yelan/shared';
import { DEFAULT_GLOBAL_BOUNDARY, effectiveBoundary, judgeStage, isSentenceEnd, maybeGlow } from '@yelan/shared';
import { createRouterFromEnv } from '../llm/create-router';
import { moderateInput } from './moderation';
import { assembleSystemPrompt } from '../prompts/assemble';
import { consumeQuota } from '../services/billing';
import { recordCost } from './cost-tracker';
import { getProviderPrice } from '@yelan/llm';

export async function* handleChatTurn(env: Env, userId: string, body: ChatRequest): AsyncGenerator<ChatStreamEvent> {
  // 0. quota check
  const quota = await consumeQuota(env, userId, 'daily_free');
  if (!quota.ok) {
    yield { kind: 'cutoff', reason: 'quota' };
    yield { kind: 'done' };
    return;
  }

  // 1. moderation
  const mod = await moderateInput(env, body.text);
  if (!mod.ok) {
    yield { kind: 'error', code: 'MODERATION', message: mod.reason ?? 'blocked' };
    return;
  }

  // 2. boundary
  const globalMax = Number(env.NARRATIVE_BOUNDARY_GLOBAL ?? DEFAULT_GLOBAL_BOUNDARY) as 1 | 2 | 3 | 4 | 5;
  const boundary = effectiveBoundary(body.userBoundary, globalMax);

  // 3. stage
  const stage = judgeStage({
    round: body.round,
    text: body.text,
    hourLocal: new Date().getHours(),
    prevStage: body.prevStage,
  });

  yield { kind: 'meta', stage, boundary };

  // 4. assemble prompt
  const system = await assembleSystemPrompt(env, {
    characterId: body.characterId,
    stage,
    boundary,
    recall: body.recall,
    cutoffWarning: body.cutoffWarning ?? false,
  });

  // 5. stream
  const router = createRouterFromEnv(env);
  let buffer = '';
  let inputTokens = 0;
  let outputTokens = 0;

  for await (const chunk of router.stream(stage, {
    model: '',
    messages: [{ role: 'system', content: system }, ...body.history, { role: 'user', content: body.text }],
  })) {
    buffer += chunk.text;
    if (chunk.usage) {
      inputTokens = chunk.usage.inputTokens;
      outputTokens = chunk.usage.outputTokens;
    }
    const sentenceEnd = isSentenceEnd(chunk.text);
    yield {
      kind: 'chunk',
      text: chunk.text,
      sentenceEnd,
      glow: sentenceEnd ? maybeGlow(buffer) : false,
    };
    if (sentenceEnd) buffer = '';
  }

  // 6. cost tracking (async, fire-and-forget)
  if (inputTokens > 0 || outputTokens > 0) {
    const price = getProviderPrice(router.getMainModel() ?? undefined);
    const costUsd = inputTokens * price.input + outputTokens * price.output;
    void recordCost(env, {
      userId,
      provider: router.mainProviderId ?? 'unknown',
      model: router.getMainModel() ?? '',
      inputTokens,
      outputTokens,
      costUsd: +costUsd.toFixed(6),
      stage,
      sessionId: body.sessionId,
    });
  }

  yield { kind: 'done' };
}
