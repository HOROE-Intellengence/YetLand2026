import { describe, it, expect } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { splitMath, MathText } from './MathText';

describe('splitMath', () => {
  it('纯文本无公式 → 单个 text 片段', () => {
    expect(splitMath('你好世界')).toEqual([{ type: 'text', value: '你好世界' }]);
  });

  it('块级 $$...$$ 被识别为 display 公式', () => {
    expect(splitMath('看：$$E=mc^2$$ 完')).toEqual([
      { type: 'text', value: '看：' },
      { type: 'math', value: 'E=mc^2', display: true },
      { type: 'text', value: ' 完' },
    ]);
  });

  it('行内 $...$ 被识别为非 display 公式', () => {
    expect(splitMath('设 $x=1$ 时')).toEqual([
      { type: 'text', value: '设 ' },
      { type: 'math', value: 'x=1', display: false },
      { type: 'text', value: ' 时' },
    ]);
  });

  it('块级支持跨行', () => {
    expect(splitMath('$$\na+b\n$$')).toEqual([
      { type: 'math', value: '\na+b\n', display: true },
    ]);
  });

  it('货币写法不应被误判为公式', () => {
    // "$5 ... $10" 两侧紧贴空白 → 不匹配行内规则
    const segs = splitMath('这要 $5 还是 $10 ？');
    expect(segs).toEqual([{ type: 'text', value: '这要 $5 还是 $10 ？' }]);
  });

  it('空公式 $$ $$ 当作纯文本', () => {
    expect(splitMath('a $$  $$ b')).toEqual([{ type: 'text', value: 'a $$  $$ b' }]);
  });

  it('多个公式混排', () => {
    const segs = splitMath('$a$ 和 $$b$$');
    expect(segs).toEqual([
      { type: 'math', value: 'a', display: false },
      { type: 'text', value: ' 和 ' },
      { type: 'math', value: 'b', display: true },
    ]);
  });
});

describe('MathText 端到端渲染', () => {
  it('用户报的引力公式应渲染成 KaTeX 而非残留 $', () => {
    const html = renderToStaticMarkup(
      createElement(MathText, { children: '公式很简单：$F = G \\frac{m_1 m_2}{r^2}$。' }),
    );
    // 渲染出 KaTeX 结构
    expect(html).toContain('katex');
    expect(html).toContain('mfrac'); // 分数确实建出来了
    // 公式区间内不应残留原始定界符 $（前后纯文本里的「：」「。」不含 $）
    expect(html).not.toContain('$');
    // 周围纯文本保留
    expect(html).toContain('公式很简单');
  });
});
