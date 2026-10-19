export type ReadingBlock = { label: string; text: string };
const labels: Record<string, string> = {
  user: '用户',
  assistant: 'AI',
  system: '系统设定',
  developer: '补充设定',
  tool: '工具结果',
  content: '正文',
  text: '正文',
  title: '标题',
  name: '名称',
  description: '说明',
  summary: '摘要',
  body: '正文',
  message: '消息',
  messages: '对话',
  chapters: '章节',
  narrative: '叙述',
  dialogue: '对话',
  speaker: '发言人',
  role: '身份',
  choices: '选项',
  options: '选项',
  reasoning: '思考',
  thought: '思考',
  world: '世界设定',
  lore: '背景',
  cast: '人物',
  journal: '日志',
  notes: '笔记',
  paragraphs: '段落',
  transcript: '实录',
  error: '错误',
  status: '状态',
};
export const recordLabel = (key: string) =>
  labels[key] ?? (/^[a-zA-Z_][\w.-]*$/.test(key) ? '补充内容' : key);
export function latestUserInput(request: string | undefined): unknown {
  if (!request) return null;
  try {
    const parsed = JSON.parse(request);
    const messages = Array.isArray(parsed) ? parsed : parsed.messages;
    if (!Array.isArray(messages)) return request;
    return messages.filter((m) => m.role === 'user').slice(-1);
  } catch {
    return request;
  }
}
const hidden =
  /^(id|.*Id|model|object|created|createdAt|updatedAt|usage|index|finish_reason|system_fingerprint|apiKey|authorization|token|password|cookie|reasoning_content)$/i;
function parse(text: string): unknown {
  const clean = text
    .trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```$/, '');
  if (!/^[[{]/.test(clean)) return text;
  try {
    return JSON.parse(clean);
  } catch {
    return text;
  }
}
export function readingBlocks(value: unknown, label = '正文', depth = 0): ReadingBlock[] {
  if (depth > 15 || value == null) return [];
  if (typeof value === 'string') {
    const parsed = parse(value);
    if (parsed !== value) return readingBlocks(parsed, label, depth + 1);
    const field = value.match(/^([^:\n：]{1,80})[：:]\s*([[{][\s\S]*)$/);
    if (field?.[2]) {
      const nested = parse(field[2]);
      if (nested !== field[2]) return readingBlocks(nested, recordLabel(field[1]!), depth + 1);
    }
    if (/^\s*(?:data:|event:)/m.test(value)) {
      let content = '';
      for (const event of value.split(/\r?\n\r?\n/)) {
        const data = event
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        try {
          const item = JSON.parse(data);
          content +=
            item.choices?.[0]?.delta?.content ??
            item.choices?.[0]?.message?.content ??
            (item.kind === 'chunk' ? item.text : '') ??
            '';
        } catch {
          /* Partial archived frames are not presented as code. */
        }
      }
      return content
        ? readingBlocks(content, label, depth + 1)
        : [{ label, text: '这条记录没有可读取的正文（可能为工具调用或不完整的流式记录）。' }];
    }
    if (/^\s*(?:\{\s*(?:"|$)|\[\s*(?:[[{"\d-]|true|false|null|$)|```json)/.test(value))
      return [{ label, text: '结构化记录不完整，无法还原正文。' }];
    const text = value
      .replace(
        /^(?:role|发言身份)[：:]\s*(user|assistant|system)\s*$/gm,
        (_, role: string) => labels[role] ?? role,
      )
      .replace(
        /^(content|text|summary|title|description)[：:]\s*/gm,
        (_, key: string) => `${recordLabel(key)}：`,
      );
    return text.trim() ? [{ label, text }] : [];
  }
  if (Array.isArray(value)) return value.flatMap((item) => readingBlocks(item, label, depth + 1));
  if (typeof value !== 'object') return [{ label, text: String(value) }];
  const row = value as Record<string, unknown>;
  if (row.type === 'text' && typeof row.text === 'string')
    return readingBlocks(row.text, label, depth + 1);
  if (row.type === 'image_url' || row.type === 'image') return [{ label, text: '〔图片附件〕' }];
  if (row.type === 'input_audio' || row.type === 'audio') return [{ label, text: '〔音频附件〕' }];
  if (row.type === 'file') return [{ label, text: '〔文件附件〕' }];
  if (
    Array.isArray(row.choices) &&
    row.choices.some((c) => c && typeof c === 'object' && ('message' in c || 'delta' in c))
  )
    return row.choices.flatMap((c) => readingBlocks(c.message ?? c.delta, label, depth + 1));
  if (typeof row.role === 'string') {
    const blocks = readingBlocks(row.content ?? row.text, labels[row.role] ?? row.role, depth + 1);
    if (row.tool_calls) blocks.push({ label: '工具调用', text: '本轮调用了工具。' });
    return blocks;
  }
  return Object.entries(row)
    .filter(([key]) => !hidden.test(key))
    .flatMap(([key, item]) => readingBlocks(item, recordLabel(key), depth + 1));
}
