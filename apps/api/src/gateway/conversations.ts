import type { ApiChatMessage } from '@yelan/shared';
import type { CallRow } from './database';

export type ChatRow = Pick<CallRow, 'id' | 'request' | 'outputText' | 'createdAt'>;

function readableContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part: Record<string, unknown> | null) => {
      if (!part || typeof part !== 'object') return '';
      if (typeof part.text === 'string') return part.text;
      if (part.type === 'image_url') return '[图片]';
      if (part.type === 'input_audio') return '[音频]';
      if (part.type === 'file') return '[文件]';
      return '[非文本内容]';
    })
    .filter(Boolean)
    .join('\n');
}

// Clients resend their history on every request. Only the newest user turn and
// the observed response belong in this key's timeline; raw context stays archived.
export function chatMessages(row: ChatRow): ApiChatMessage[] {
  const request = JSON.parse(row.request) as { messages?: { role: string; content?: unknown }[] };
  const history = Array.isArray(request.messages) ? request.messages : [];
  let lastAssistant = -1;
  history.forEach((message, index) => {
    if (message.role === 'assistant') lastAssistant = index;
  });
  const messages: ApiChatMessage[] = history.flatMap((message, index) => {
    if (index <= lastAssistant || message.role !== 'user') return [];
    const content = readableContent(message.content);
    return content ? [{ id: `${row.id}:user:${index}`, role: 'user' as const, content }] : [];
  });
  if (row.outputText)
    messages.push({ id: `${row.id}:assistant`, role: 'assistant', content: row.outputText });
  return messages;
}
