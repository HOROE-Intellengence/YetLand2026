// token 硬闸 — 服务端执行，不依赖前端
// 单用户单 session token 上限 + 全局日 token 上限
import { store } from '../store/persistence';
import { logError } from './error-logger';

interface TokenGuardCtx {
  requestId?: string;
  userId?: string;
}

let _dailyTokens = 0;
let _dailyDate = today();
// 按 session 跟踪实际 token 消耗
const _sessionTokens = new Map<string, number>();

const SESSION_TOKEN_LIMIT = Number(process.env.SESSION_TOKEN_LIMIT) || 200_000;
const GLOBAL_DAILY_TOKEN_LIMIT = Number(process.env.GLOBAL_DAILY_TOKEN_LIMIT) || 2_000_000;
// token 硬闸总开关：off → 不再因累计 token 超限回退 mock（长会话降级交给上下文压缩处理）。
const TOKEN_GUARD_ENABLED = process.env.TOKEN_GUARD_ENABLED !== 'off';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetDailyIfNeeded(): void {
  const d = today();
  if (d !== _dailyDate) {
    _dailyTokens = 0;
    _dailyDate = d;
    _sessionTokens.clear();
  }
}

export function getTokenLimits() {
  return {
    sessionTokenLimit: SESSION_TOKEN_LIMIT,
    globalDailyTokenLimit: GLOBAL_DAILY_TOKEN_LIMIT,
    currentDailyTokens: _dailyTokens,
  };
}

export function checkTokenBudget(
  sessionId: string,
  estimatedTokens: number,
  ctx?: TokenGuardCtx,
): { allowed: boolean; reason?: string } {
  if (!TOKEN_GUARD_ENABLED) return { allowed: true };
  resetDailyIfNeeded();

  if (_dailyTokens + estimatedTokens > GLOBAL_DAILY_TOKEN_LIMIT) {
    logError({
      ts: new Date().toISOString(),
      requestId: ctx?.requestId ?? 'unknown',
      method: 'TOKEN_GUARD',
      path: '/api/chat',
      status: 429,
      code: 'TOKEN_GUARD_TRIPPED',
      message: `global_daily_token_limit: ${_dailyTokens}/${GLOBAL_DAILY_TOKEN_LIMIT}`,
      userId: ctx?.userId,
    });
    return { allowed: false, reason: 'global_daily_token_limit' };
  }

  const sessionTokens = _sessionTokens.get(sessionId) ?? 0;
  if (sessionTokens + estimatedTokens > SESSION_TOKEN_LIMIT) {
    logError({
      ts: new Date().toISOString(),
      requestId: ctx?.requestId ?? 'unknown',
      method: 'TOKEN_GUARD',
      path: '/api/chat',
      status: 429,
      code: 'TOKEN_GUARD_TRIPPED',
      message: `session_token_limit: ${sessionTokens}/${SESSION_TOKEN_LIMIT}`,
      userId: ctx?.userId,
    });
    return { allowed: false, reason: 'session_token_limit' };
  }

  return { allowed: true };
}

export function recordTokenUsage(sessionId: string, tokens: number): void {
  resetDailyIfNeeded();
  _dailyTokens += tokens;
  const cur = _sessionTokens.get(sessionId) ?? 0;
  _sessionTokens.set(sessionId, cur + tokens);
}

export function estimateTokens(text: string, historyLength: number): number {
  return Math.ceil(text.length / 2) + historyLength * 100 + 500;
}
