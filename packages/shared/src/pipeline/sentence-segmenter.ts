// 句末判定 + 关键句 glow 启发式。api / server 共用的纯逻辑。
const SENTENCE_END = /[。！？…!?]["”」』）)]?\s*$/;

export function isSentenceEnd(text: string): boolean {
  return SENTENCE_END.test(text);
}

const GLOW_HINTS = [
  '其实', '真的', '一直', '等了', '不会', '永远', '别走', '别离开',
  '想你', '记得', '只有你', '答应我',
];

/** 启发式：句子触发 glow（前端做关键句停顿） */
export function maybeGlow(sentence: string): boolean {
  if (sentence.length < 3) return false;
  if (sentence.endsWith('—') || sentence.endsWith('——')) return true;
  return GLOW_HINTS.some((h) => sentence.includes(h));
}
