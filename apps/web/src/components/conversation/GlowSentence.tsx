// 关键句 — gold-light 微光 + 前置 600~800ms 停顿（修订 #25）
// 数据: 后端在 SSE chunk 里给 glow:true 的句子；前端在浮现前插停顿
export function GlowSentence({ children }: { children: React.ReactNode }) {
  return <span style={{ color: 'var(--gold-light)' }}>{children}</span>;
}
