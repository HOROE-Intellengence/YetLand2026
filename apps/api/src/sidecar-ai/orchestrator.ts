// 侧袋 AI 编排器 — 管理执行顺序与独立开关
// 关掉某个侧袋 AI 就自动从执行链中跳过，不影响其他侧袋继续跑通
//
// 五个侧袋并非完全自由排序——部分有前置条件（checkpoint）：
//   quotaExhausted: quotaEnding（仅额度耗尽时）
//   preMain:        atmosphereJudge（需先于主 AI 装配 system prompt）
//   postMain:       outputStructurer（需等主 AI 输出完成）
//   afterDone:      preferenceRecorder, contextCompressor（异步，不阻塞用户）
//
// 顺序规则作用于同一 checkpoint 内的侧袋之间。
import type { SidecarPromptKey } from './types';
import { store } from '../store/persistence';

// ── 真理源 ──────────────────────────────────────────────────────
export const SIDECAR_KEYS: SidecarPromptKey[] = [
  'atmosphereJudge',
  'outputStructurer',
  'preferenceRecorder',
  'quotaEnding',
  'contextCompressor',
];

export const DEFAULT_SIDECAR_ORDER: SidecarPromptKey[] = [
  'atmosphereJudge',
  'outputStructurer',
  'preferenceRecorder',
  'quotaEnding',
  'contextCompressor',
];

// ── 校验 ────────────────────────────────────────────────────────

/** 校验 order 是否合法：长度 5、无重复、恰好包含全部 5 个 key */
export function isValidSidecarOrder(order: unknown): order is SidecarPromptKey[] {
  if (!Array.isArray(order) || order.length !== SIDECAR_KEYS.length) return false;
  const seen = new Set<string>();
  for (const k of order) {
    if (typeof k !== 'string' || !(SIDECAR_KEYS as string[]).includes(k)) return false;
    if (seen.has(k)) return false;
    seen.add(k);
  }
  return seen.size === SIDECAR_KEYS.length;
}

// ── 读取 ────────────────────────────────────────────────────────

/** 获取完整侧袋顺序（含禁用的），总是返回合法的 5 项 */
export function getFullSidecarOrder(): SidecarPromptKey[] {
  const s = store.state();
  const raw = s.sidecarOrder;
  if (isValidSidecarOrder(raw)) return raw;
  return [...DEFAULT_SIDECAR_ORDER];
}

/** 获取有效执行顺序（过滤掉禁用的） */
export function getEffectiveSidecarOrder(): SidecarPromptKey[] {
  return getFullSidecarOrder().filter((key) => isSidecarEnabled(key));
}

/**
 * 给一组"当前阶段可运行"的侧袋按后台配置排序。
 * 不在配置 order 里的 key 直接忽略。
 */
export function orderSidecars(keys: SidecarPromptKey[]): SidecarPromptKey[] {
  const full = getFullSidecarOrder();
  return keys
    .filter((k) => isSidecarEnabled(k))
    .sort((a, b) => full.indexOf(a) - full.indexOf(b));
}

/** 检查某个侧袋 AI 是否启用 */
export function isSidecarEnabled(key: SidecarPromptKey): boolean {
  const s = store.state();
  return s.sidecarEnabled?.[key] ?? true;
}

/** 获取全部启用/禁用状态 */
export function getSidecarEnabledMap(): Record<SidecarPromptKey, boolean> {
  const map = {} as Record<SidecarPromptKey, boolean>;
  for (const k of SIDECAR_KEYS) map[k] = isSidecarEnabled(k);
  return map;
}

// ── 写入 ────────────────────────────────────────────────────────

/** 设置侧袋 AI 启用状态 */
export function setSidecarEnabled(key: SidecarPromptKey, enabled: boolean): void {
  const s = store.state();
  s.sidecarEnabled[key] = enabled;
  store.save();
}

/** 设置侧袋执行顺序——拒绝脏数据 */
export function setSidecarOrder(order: SidecarPromptKey[]): void {
  if (!isValidSidecarOrder(order)) throw new Error('invalid sidecar order');
  const s = store.state();
  s.sidecarOrder = order;
  store.save();
}
