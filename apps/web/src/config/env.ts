// ────────────────────────────────────────────────────────────────────────────
// 应用配置 — 集中读 import.meta.env，并支持运行期 apiBase 覆盖
// ----------------------------------------------------------------------------
// apiBase 解析优先级（高 → 低）：
//   1. URL 参数 ?api=https://api.example.com    （首次访问可一键带过来；自动落 localStorage）
//   2. localStorage['yelan.apiBase']            （用户在设置面板改过）
//   3. import.meta.env.VITE_API_BASE            （构建期默认；仓库根 .env）
//   4. http://localhost:8787                    （兜底）
//
// 这套设计让"本机 vs 服务器"一键切换：发布版 App 默认指向生产 API；
// 用户也可以在 URL 后加 ?api= 临时切到 staging / 本地后台调试。
// ────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'yelan.apiBase';

/** 从 URL ?api=... 取值并落 localStorage（一次性，下次访问由 localStorage 接管） */
function pickFromUrl(): string | null {
  if (typeof location === 'undefined') return null;
  const url = new URL(location.href);
  const v = url.searchParams.get('api');
  if (!v) return null;
  try {
    localStorage.setItem(STORAGE_KEY, v);
    // 清掉 URL 上的 ?api 避免分享时泄露
    url.searchParams.delete('api');
    history.replaceState({}, '', url.toString());
  } catch { /* ignore */ }
  return v;
}

function pickFromStorage(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch { return null; }
}

function resolveApiBase(): string {
  const fromUrl = pickFromUrl();
  if (fromUrl) return fromUrl;
  const fromStorage = pickFromStorage();
  if (fromStorage) return fromStorage;
  return import.meta.env.VITE_API_BASE || 'http://localhost:8787';
}

export const env = {
  apiBase: resolveApiBase(),
  useMock: (import.meta.env.VITE_USE_MOCK ?? 'true') === 'true',
  sentryDsn: import.meta.env.VITE_SENTRY_DSN_WEB ?? null,
};

/**
 * 给 UI（settings drawer / dev tweaks panel）调用：切换 API base 并刷新页面。
 * 传 null / 空串恢复构建期默认值。
 */
export function setApiBase(base: string | null): void {
  try {
    if (base) localStorage.setItem(STORAGE_KEY, base);
    else localStorage.removeItem(STORAGE_KEY);
  } catch { /* ignore */ }
  // 简单刷新 — 让所有 React Query 缓存重置；以后可以改成 store reset
  location.reload();
}

/** 给设置面板显示当前 base + 来源 */
export function describeApiBase(): { base: string; source: 'url' | 'storage' | 'env' | 'fallback' } {
  if (typeof location !== 'undefined') {
    const url = new URL(location.href);
    if (url.searchParams.get('api')) return { base: env.apiBase, source: 'url' };
  }
  if (pickFromStorage()) return { base: env.apiBase, source: 'storage' };
  if (import.meta.env.VITE_API_BASE) return { base: env.apiBase, source: 'env' };
  return { base: env.apiBase, source: 'fallback' };
}
