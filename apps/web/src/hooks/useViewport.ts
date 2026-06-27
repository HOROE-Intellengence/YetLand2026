// 移动端视口能力钩子 —— 移动端适配长期方案 §4.3 / Phase 0
//
// 暴露：isMobile / isCoarsePointer / prefersReducedMotion / lowEndDevice / keyboardInset。
// 副作用：把软键盘高度写入 <html> 的 --keyboard-inset CSS 变量，供 CSS 直接消费。
//
// 设计：可观测状态的「计算」全部抽成纯函数（computeKeyboardInset / detectLowEndDevice /
// readViewport），React 只负责订阅 matchMedia / visualViewport 并回灌状态。纯函数便于在
// 无 DOM 的 node 测试环境里覆盖（见 useViewport.test.ts），与仓库既有「测纯逻辑」风格一致。
import { useEffect, useState } from 'react';
import { breakpoints } from '@yelan/design-tokens';

// 媒体查询：< md 视为手机（与选角页 768 断点对齐）。-0.02 避开 768 整点的边界抖动。
const MOBILE_QUERY = `(max-width: ${breakpoints.md - 0.02}px)`;
const COARSE_POINTER_QUERY = '(pointer: coarse)';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

// 低端机启发式阈值（可在 Phase 5 调参）：deviceMemory 以 GB 计、hardwareConcurrency 以逻辑核计。
const LOW_END_MEMORY_GB = 4;
const LOW_END_CORES = 4;

export interface Viewport {
  /** 视口宽度 < md(768) */
  isMobile: boolean;
  /** 粗指针（触屏）—— 决定是否放大命中区 / 切手势 */
  isCoarsePointer: boolean;
  /** 系统「减少动态效果」 */
  prefersReducedMotion: boolean;
  /** 低端设备启发式 —— 供动效降级 */
  lowEndDevice: boolean;
  /** 软键盘遮挡高度（px，≥0）*/
  keyboardInset: number;
}

const SSR_DEFAULT: Viewport = {
  isMobile: false,
  isCoarsePointer: false,
  prefersReducedMotion: false,
  lowEndDevice: false,
  keyboardInset: 0,
};

// navigator 上的非标准/可选字段
interface DeviceNavigator {
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

/**
 * 软键盘遮挡高度：布局视口高 - 可视视口高 - 可视视口顶偏移。
 * 键盘弹出时 visualViewport.height 收缩 → 得到被遮挡的底部高度。取整、夹到 ≥0。
 * 纯函数：入参为已读出的数值，便于测试。
 */
export function computeKeyboardInset(
  innerHeight: number,
  visualViewportHeight: number,
  visualViewportOffsetTop: number,
): number {
  return Math.max(0, Math.round(innerHeight - visualViewportHeight - visualViewportOffsetTop));
}

/**
 * 低端机启发式：内存或逻辑核数任一落在低档即判低端。
 * iOS Safari 不暴露 deviceMemory，故用「任一为真」而非「全部为真」，避免在 iOS 永不触发。
 */
export function detectLowEndDevice(deviceMemory?: number, hardwareConcurrency?: number): boolean {
  if (typeof deviceMemory === 'number' && deviceMemory > 0 && deviceMemory <= LOW_END_MEMORY_GB) {
    return true;
  }
  if (
    typeof hardwareConcurrency === 'number' &&
    hardwareConcurrency > 0 &&
    hardwareConcurrency <= LOW_END_CORES
  ) {
    return true;
  }
  return false;
}

/**
 * 从 window 快照一次 Viewport。无 window（SSR / node 测试）时返回保守默认值。
 * 直接读 matchMedia / visualViewport / navigator —— 测试中替换 globalThis.window 即可注入。
 */
export function readViewport(): Viewport {
  if (typeof window === 'undefined') return SSR_DEFAULT;
  const nav = window.navigator as Navigator & DeviceNavigator;
  const vv = window.visualViewport;
  return {
    isMobile: window.matchMedia(MOBILE_QUERY).matches,
    isCoarsePointer: window.matchMedia(COARSE_POINTER_QUERY).matches,
    prefersReducedMotion: window.matchMedia(REDUCED_MOTION_QUERY).matches,
    lowEndDevice: detectLowEndDevice(nav?.deviceMemory, nav?.hardwareConcurrency),
    keyboardInset: vv ? computeKeyboardInset(window.innerHeight, vv.height, vv.offsetTop) : 0,
  };
}

function writeKeyboardInset(value: number): void {
  document.documentElement.style.setProperty('--keyboard-inset', `${value}px`);
}

export function useViewport(): Viewport {
  const [state, setState] = useState<Viewport>(readViewport);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const sync = () => {
      const next = readViewport();
      writeKeyboardInset(next.keyboardInset);
      setState(next);
    };

    const queries = [MOBILE_QUERY, COARSE_POINTER_QUERY, REDUCED_MOTION_QUERY].map((q) =>
      window.matchMedia(q),
    );
    queries.forEach((mql) => mql.addEventListener('change', sync));

    const vv = window.visualViewport;
    vv?.addEventListener('resize', sync);
    vv?.addEventListener('scroll', sync);
    window.addEventListener('resize', sync);

    // 挂载即同步一次（覆盖 SSR 默认值 / 首帧后的真实视口）
    sync();

    return () => {
      queries.forEach((mql) => mql.removeEventListener('change', sync));
      vv?.removeEventListener('resize', sync);
      vv?.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, []);

  return state;
}
