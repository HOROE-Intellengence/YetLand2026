import { describe, expect, it } from 'vitest';
import { breakpoints, paragraphGap, proseWidth, sizes, stageLayout, typeScale } from './tokens';

// 基础数值护栏 —— 移动端适配长期方案 §1 / Phase 0
//
// tokens.ts 是 web + share + 长图导出的共享基准。这些基础 px 值【绝不】能被改成 vw/clamp，
// 否则无视口的长图导出渲染环境会炸（见方案 §2.1 第 4 条）。流式只发生在 web 专属 fluid.css 层。
// 本测试把基础值钉死：任何改动都会红，逼改动者显式确认。

describe('design tokens · 基础数值护栏', () => {
  it('sizes 基础 px 值锁定', () => {
    expect(sizes).toEqual({
      xxs: 11,
      xs: 12,
      sm: 13,
      md: 15,
      lg: 17,
      xl: 20,
      '2xl': 24,
      '3xl': 32,
    });
  });

  it('typeScale / proseWidth / paragraphGap 锁定', () => {
    expect(typeScale).toBe(1.3);
    expect(proseWidth).toBe(560);
    expect(paragraphGap).toBe(24);
  });

  it('stageLayout 锁定', () => {
    expect(stageLayout).toEqual({
      daily: { gutter: 80, fontPx: 15, lineHeight: 1.9 },
      rise: { gutter: 60, fontPx: 15, lineHeight: 1.8 },
      climax: { gutter: 40, fontPx: 16, lineHeight: 1.7 },
      after: { gutter: 80, fontPx: 15, lineHeight: 2.0 },
      end: { gutter: 80, fontPx: 15, lineHeight: 2.0 },
    });
  });

  it('breakpoints 锁定（新增三档，web 专属纯常量）', () => {
    expect(breakpoints).toEqual({ sm: 480, md: 768, lg: 980 });
  });
});
