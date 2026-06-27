import { DEFAULT_USER_BOUNDARY } from '@yelan/shared';
import { store, type SessionRow } from '../store/persistence';
import { getUserById, patchUserFlags } from './users';

export interface IfUnlockResult {
  matched: boolean;
  ifActive: boolean;
  // 命中暗号当轮的瞬时升温目标温度。仅在 matched=true（本轮文本命中暗号）时可能出现，
  // 由 resolveTemperature 用于「当轮直接跳温」，不写入任何地板。
  forcedTemperature?: 1 | 2 | 3 | 4 | 5;
}

// session 级 IF 激活判定（不含 user 级永久解锁）。
// chat 装配前置卡与 resolveIfUnlockFromText 的宽口径计算共用，避免两处谓词漂移。
export function isSessionIfActive(session: SessionRow | undefined | null): boolean {
  return Boolean(session?.ifActive || session?.mode === 'if');
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase();
}

// 把空格/下划线/各类连字符（含全角 － 与中英破折号）都归一为单个 '-'，
// 让 "YELAN MOON" / "YELAN－MOON" 也能命中 "YELAN-MOON"。
const SEPARATORS = /[\s_\-‐-―－]+/g;

function normalizeForMatch(value: string): string {
  return value.trim().toUpperCase().replace(SEPARATORS, '-');
}

// 词边界：暗号两侧必须是字符串端点或非字母数字，避免短码（如 MOON）误中 MOONLIGHT。
function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || !/[A-Z0-9]/.test(ch);
}

function findCodeFromText(text: string) {
  const normalized = normalizeForMatch(text);
  if (!normalized) return null;
  return (
    store.state().ifCodes.find((code) => {
      if (!code.active) return false;
      const needle = normalizeForMatch(code.code);
      if (!needle) return false;
      for (let from = 0; from <= normalized.length; ) {
        const idx = normalized.indexOf(needle, from);
        if (idx === -1) return false;
        const before = idx === 0 ? undefined : normalized[idx - 1];
        const after = idx + needle.length >= normalized.length ? undefined : normalized[idx + needle.length];
        if (isBoundary(before) && isBoundary(after)) return true;
        from = idx + 1;
      }
      return false;
    }) ?? null
  );
}

function findExactCode(code: string) {
  const normalized = normalizeCode(code);
  return store.state().ifCodes.find((item) => item.active && item.code === normalized) ?? null;
}

function activateIf(
  userId: string,
  sessionId: string | null,
  code: string,
  boundary: 1 | 2 | 3 | 4 | 5,
  forcedTemperature?: 1 | 2 | 3 | 4 | 5,
): IfUnlockResult {
  const s = store.state();
  const exists = s.ifRedemptions.find((row) => row.userId === userId && row.code === code);
  if (!exists) {
    s.ifRedemptions.push({ userId, code, ts: new Date().toISOString() });
  }

  const user = getUserById(userId);
  const newBoundary = Math.max(user?.narrativeBoundary ?? DEFAULT_USER_BOUNDARY, boundary) as 1 | 2 | 3 | 4 | 5;
  patchUserFlags(userId, { ifUnlocked: true, narrativeBoundary: newBoundary });

  if (sessionId) {
    const sess = s.sessions[sessionId];
    if (sess) {
      sess.mode = 'if';
      sess.ifActive = true;
      sess.updatedAt = new Date().toISOString();
    }
  }

  store.save();
  return { matched: true, ifActive: true, ...(forcedTemperature != null ? { forcedTemperature } : {}) };
}

export function resolveIfUnlockFromText(userId: string, sessionId: string, text: string): IfUnlockResult {
  const def = findCodeFromText(text);
  if (def) return activateIf(userId, sessionId, def.code, def.boundary, def.temperature);

  const user = getUserById(userId);
  const sess = store.state().sessions[sessionId];
  return { matched: false, ifActive: Boolean(user?.ifUnlocked) || isSessionIfActive(sess) };
}

export function redeemIfCode(userId: string, code: string, sessionId?: string): IfUnlockResult {
  const def = findExactCode(code);
  if (!def) {
    const user = getUserById(userId);
    return { matched: false, ifActive: Boolean(user?.ifUnlocked) };
  }
  return activateIf(userId, sessionId ?? null, def.code, def.boundary, def.temperature);
}
