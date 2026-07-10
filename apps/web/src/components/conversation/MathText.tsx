// LaTeX 公式解析 — 把含 $$...$$（块级）/ $...$（行内）的文本切片后用 KaTeX 渲染
// 非公式片段原样作为纯文本输出，渲染失败时降级为原始文本（绝不抛错打断对话）
import { useMemo } from 'react';
import katex from 'katex';
import 'katex/dist/katex.min.css';

// 一个片段要么是普通文本，要么是一段待渲染的公式
type Segment =
  | { type: 'text'; value: string }
  | { type: 'math'; value: string; display: boolean };

// 依次匹配 $$...$$（块级，优先）与 $...$（行内）。
// - 块级允许跨行；行内不跨行，且要求两侧 $ 紧贴非空白，避免把「$5 ... $10」这类货币写法误判成公式。
const MATH_PATTERN = /\$\$([\s\S]+?)\$\$|\$(?!\s)([^$\n]*?)(?<!\s)\$/g;

export function splitMath(input: string): Segment[] {
  const segments: Segment[] = [];
  // 追加文本时与上一段文本合并，避免「a」「$$  $$」「b」碎成多个相邻 span
  const pushText = (value: string) => {
    const last = segments[segments.length - 1];
    if (last && last.type === 'text') {
      last.value += value;
    } else {
      segments.push({ type: 'text', value });
    }
  };

  let lastIndex = 0;
  for (const match of input.matchAll(MATH_PATTERN)) {
    const start = match.index ?? 0;
    if (start > lastIndex) {
      pushText(input.slice(lastIndex, start));
    }
    const display = match[1] != null;
    const formula = (display ? match[1] : match[2]) ?? '';
    // $$ $$ / $ $ 里只有空白 → 当普通文本，避免空公式
    if (formula.trim() === '') {
      pushText(match[0]);
    } else {
      segments.push({ type: 'math', value: formula, display });
    }
    lastIndex = start + match[0].length;
  }
  if (lastIndex < input.length) {
    pushText(input.slice(lastIndex));
  }
  return segments;
}

function MathSpan({ value, display }: { value: string; display: boolean }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(value, {
        displayMode: display,
        throwOnError: false, // KaTeX 自身错误兜底成红色提示而非抛异常
        output: 'htmlAndMathml',
      });
    } catch {
      return null; // 极端情况（非 ParseError）再降级为原始文本
    }
  }, [value, display]);

  if (html == null) {
    return <span>{display ? `$$${value}$$` : `$${value}$`}</span>;
  }
  return (
    <span
      style={display ? { display: 'block', margin: '0.4em 0' } : undefined}
      // KaTeX 输出可信（由本地 katex 生成，输入是模型文本而非 HTML）
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// 把可能含 LaTeX 的字符串渲染为「文本 + 公式」混排
export function MathText({ children }: { children: string }) {
  const segments = useMemo(() => splitMath(children), [children]);
  // 没有任何公式时直接回退为纯文本，零额外包裹
  if (segments.length === 1 && segments[0]!.type === 'text') {
    return <>{children}</>;
  }
  return (
    <>
      {segments.map((seg, i) =>
        seg.type === 'text' ? (
          <span key={i}>{seg.value}</span>
        ) : (
          <MathSpan key={i} value={seg.value} display={seg.display} />
        ),
      )}
    </>
  );
}
