// 上下文压缩 AI — 对话超过 15 轮时触发
// 将超出最近 15 轮的旧对话压缩为概要
import type { ContextCompressResult, SidecarResult } from './types';
import { getPrompt } from './prompts';
import { sidecarCallWithSchema } from './client';
import { ContextCompressResultSchema } from '@yelan/shared';
import { store } from '../store/persistence';

export async function compressContext(
  oldConversation: string,
  existingSummary?: string,
): Promise<SidecarResult<ContextCompressResult>> {
  if (!oldConversation.trim()) {
    return { ok: false, error: 'empty conversation' };
  }

  const prompt = getPrompt('contextCompressor');
  const userContent = existingSummary?.trim()
    ? `[已有概要]\n${existingSummary.slice(0, 2000)}\n\n[新增旧对话]\n${oldConversation.slice(0, 4000)}`
    : oldConversation.slice(0, 4000);
  const result = await sidecarCallWithSchema(prompt, userContent, ContextCompressResultSchema, { taskKey: 'contextCompressor' });
  return result;
}

/** 存储压缩后的滚动概要 */
export function setSummary(sessionId: string, summary: string, compressedUntilMessageId?: string): void {
  const s = store.state();
  const existing = s.contextSummaries[sessionId];
  s.contextSummaries[sessionId] = {
    summary,
    updatedAt: new Date().toISOString(),
    compressedUntilMessageId: compressedUntilMessageId ?? existing?.compressedUntilMessageId,
  };
  store.save();
}

/** 获取会话概要 */
export function getSummary(sessionId: string): string {
  const row = store.state().contextSummaries[sessionId];
  return row?.summary ?? '';
}

export function getCompressedUntilMessageId(sessionId: string): string | undefined {
  const row = store.state().contextSummaries[sessionId];
  return row?.compressedUntilMessageId;
}

export function markSummaryCompressedUntil(sessionId: string, compressedUntilMessageId: string): void {
  const s = store.state();
  const existing = s.contextSummaries[sessionId]?.summary ?? '';
  s.contextSummaries[sessionId] = {
    summary: existing,
    updatedAt: new Date().toISOString(),
    compressedUntilMessageId,
  };
  store.save();
}

export function getUncompressedExpiredMessages<T extends { id: string }>(
  expired: T[],
  compressedUntilMessageId?: string,
): T[] {
  if (!compressedUntilMessageId) return expired;
  const cursorIndex = expired.findIndex((m) => m.id === compressedUntilMessageId);
  return cursorIndex >= 0 ? expired.slice(cursorIndex + 1) : expired;
}

/** 检查是否超过窗口：返回需要压缩的旧对话（轮次 > 15） */
export function getExpiredTurns<T extends { role: string; content: string }>(
  history: T[],
  keepTurns: number = 15,
): { expired: T[]; recent: T[] } {
  // 每一轮 = user + assistant 各一条
  const messagesPerTurn = 2;
  const keepMessages = keepTurns * messagesPerTurn;

  if (history.length <= keepMessages) {
    return { expired: [], recent: history };
  }

  return {
    expired: history.slice(0, history.length - keepMessages),
    recent: history.slice(history.length - keepMessages),
  };
}
