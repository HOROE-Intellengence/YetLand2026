// serif italic 14px / paper-dim / 淡入 — 用于背景 / 环境 / 动作描写
export function NarrationText({ children }: { children: React.ReactNode }) {
  return <span style={{ fontStyle: 'italic', color: 'var(--paper-dim)' }}>{children}</span>;
}
