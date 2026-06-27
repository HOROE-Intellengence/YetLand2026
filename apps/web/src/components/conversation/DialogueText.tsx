// serif 15px / paper / 句级浮现 — 角色对白主体
// TODO: 用 framer-motion useAnimate + stagger 接 sentence-buffer 的 sentence_end 信号
export function DialogueText({ children }: { children: React.ReactNode }) {
  return <span>{children}</span>;
}
