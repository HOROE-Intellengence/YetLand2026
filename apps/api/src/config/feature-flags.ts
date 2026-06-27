// 灰测 feature flags — 纯 env 控制，无需重启之外的平台依赖
// 使用：import { flag } from '../config/feature-flags'; flag('FEATURE_REAL_LLM')

const flagCache = new Map<string, boolean>();
const FLAG_DEFAULTS: Record<string, boolean> = {
  FEATURE_TEMP_V2: true,
};

function readFlag(key: string): boolean {
  const cached = flagCache.get(key);
  if (cached !== undefined) return cached;
  const raw = process.env[key];
  const value = raw === undefined || raw === ''
    ? FLAG_DEFAULTS[key] ?? false
    : raw === 'on' || raw === 'true' || raw === '1';
  flagCache.set(key, value);
  return value;
}

export function flag(key: string): boolean {
  return readFlag(key);
}

export function flagOr(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return readFlag(key);
}

/** 清空 flag 缓存 —— 配置重载后调用，让下次 flag() 重新读 process.env */
export function clearFlagCache(): void {
  flagCache.clear();
}

export const FEATURE_FLAGS = {
  /** 真实 LLM 调用开关。off 时所有 chat 走脚本化 mock 流 */
  REAL_LLM: 'FEATURE_REAL_LLM',
  /** 成就系统开关 */
  ACHIEVEMENTS: 'FEATURE_ACHIEVEMENTS',
  /** 抽屉面板级开关 */
  DRAWER_YOU: 'FEATURE_DRAWER_YOU',
  DRAWER_SUBS: 'FEATURE_DRAWER_SUBS',
  DRAWER_CANDLE: 'FEATURE_DRAWER_CANDLE',
  DRAWER_LIBRARY: 'FEATURE_DRAWER_LIBRARY',
  DRAWER_MEMORY: 'FEATURE_DRAWER_MEMORY',
  DRAWER_SEAL: 'FEATURE_DRAWER_SEAL',
  DRAWER_SURVEY: 'FEATURE_DRAWER_SURVEY',
  DRAWER_BREATH: 'FEATURE_DRAWER_BREATH',
  TEMP_V2: 'FEATURE_TEMP_V2',
  /** 记忆注入节流：4 轮 + stage 切换 + 关键词触发。off 时所有轮次都注入 profile/summary/recall */
  MEMORY_THROTTLE: 'FEATURE_MEMORY_THROTTLE',
} as const;

/** 回传给前端 /api/admin/config 的 flags（不含 secret） */
export function getClientFlags(): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const f of Object.values(FEATURE_FLAGS)) {
    result[f] = flag(f);
  }
  return result;
}
