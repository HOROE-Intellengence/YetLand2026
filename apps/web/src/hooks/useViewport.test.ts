import { afterEach, describe, expect, it } from 'vitest';
import { computeKeyboardInset, detectLowEndDevice, readViewport } from './useViewport';

describe('computeKeyboardInset', () => {
  it('键盘未弹出时返回 0', () => {
    // 可视视口 == 布局视口
    expect(computeKeyboardInset(800, 800, 0)).toBe(0);
  });

  it('键盘弹出时返回被遮挡高度', () => {
    // 布局 800，可视收缩到 500，无顶偏移 → 遮挡 300
    expect(computeKeyboardInset(800, 500, 0)).toBe(300);
  });

  it('扣除可视视口顶偏移（pinch / 滚动）', () => {
    expect(computeKeyboardInset(800, 500, 40)).toBe(260);
  });

  it('永不为负，且取整', () => {
    expect(computeKeyboardInset(800, 820, 0)).toBe(0);
    // round(800.4 - 500.1) = round(300.3) = 300
    expect(computeKeyboardInset(800.4, 500.1, 0)).toBe(300);
  });
});

describe('detectLowEndDevice', () => {
  it('内存 ≤4GB 判低端', () => {
    expect(detectLowEndDevice(4, 8)).toBe(true);
    expect(detectLowEndDevice(2, 8)).toBe(true);
  });

  it('逻辑核 ≤4 判低端（覆盖 iOS 不报 deviceMemory 的情况）', () => {
    expect(detectLowEndDevice(undefined, 4)).toBe(true);
    expect(detectLowEndDevice(undefined, 2)).toBe(true);
  });

  it('高配设备不判低端', () => {
    expect(detectLowEndDevice(8, 8)).toBe(false);
    expect(detectLowEndDevice(16, 12)).toBe(false);
  });

  it('全 undefined / 非法值（0）不判低端', () => {
    expect(detectLowEndDevice(undefined, undefined)).toBe(false);
    expect(detectLowEndDevice(0, 0)).toBe(false);
  });
});

// ---- readViewport：mock matchMedia / visualViewport / navigator ----

type MatchMap = Record<string, boolean>;

interface FakeWindowParts {
  matches?: MatchMap;
  innerHeight?: number;
  visualViewport?: { height: number; offsetTop: number } | null;
  deviceMemory?: number;
  hardwareConcurrency?: number;
}

function installFakeWindow(parts: FakeWindowParts): void {
  const matches = parts.matches ?? {};
  const fake = {
    innerHeight: parts.innerHeight ?? 800,
    matchMedia: (query: string) => ({ matches: matches[query] ?? false }),
    navigator: {
      deviceMemory: parts.deviceMemory,
      hardwareConcurrency: parts.hardwareConcurrency,
    },
    visualViewport: parts.visualViewport === undefined ? null : parts.visualViewport,
  };
  (globalThis as { window?: unknown }).window = fake;
}

describe('readViewport', () => {
  afterEach(() => {
    // node 测试环境默认无 window；清掉避免污染其它用例
    delete (globalThis as { window?: unknown }).window;
  });

  it('从 matchMedia 读出能力位', () => {
    installFakeWindow({
      matches: {
        '(max-width: 767.98px)': true,
        '(pointer: coarse)': true,
        '(prefers-reduced-motion: reduce)': true,
      },
      hardwareConcurrency: 4,
    });
    const vp = readViewport();
    expect(vp.isMobile).toBe(true);
    expect(vp.isCoarsePointer).toBe(true);
    expect(vp.prefersReducedMotion).toBe(true);
    expect(vp.lowEndDevice).toBe(true);
  });

  it('桌面（无匹配 / 高配 / 无键盘）返回全 false / 0', () => {
    installFakeWindow({
      matches: {},
      hardwareConcurrency: 16,
      deviceMemory: 16,
      visualViewport: { height: 900, offsetTop: 0 },
      innerHeight: 900,
    });
    const vp = readViewport();
    expect(vp).toEqual({
      isMobile: false,
      isCoarsePointer: false,
      prefersReducedMotion: false,
      lowEndDevice: false,
      keyboardInset: 0,
    });
  });

  it('visualViewport 收缩时算出 keyboardInset', () => {
    installFakeWindow({
      innerHeight: 800,
      visualViewport: { height: 500, offsetTop: 0 },
    });
    expect(readViewport().keyboardInset).toBe(300);
  });

  it('缺失 visualViewport 时 keyboardInset 退化为 0', () => {
    installFakeWindow({ visualViewport: null, innerHeight: 800 });
    expect(readViewport().keyboardInset).toBe(0);
  });
});
