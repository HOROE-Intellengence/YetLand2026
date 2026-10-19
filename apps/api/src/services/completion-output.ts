// Reasoning, role announcements and usage are not an assistant reply.
// Tool-only turns and explicit refusals are valid protocol output.
export function hasCompletionOutput(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const choices = (value as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return false;
  const nonblank = (text: unknown) => typeof text === 'string' &&
    text.replace(/\u00AD|\u034F|\u180E|[\u200B-\u200F]|[\u2060-\u2064]|\uFEFF/g, '').trim().length > 0;
  return choices.some(choice => {
    if (!choice || typeof choice !== 'object') return false;
    const row = choice as Record<string, unknown>;
    const message = (row.message ?? row.delta) as Record<string, unknown> | undefined;
    if (nonblank(row.text)) return true;
    if (!message || typeof message !== 'object') return false;
    if (nonblank(message.content) || nonblank(message.refusal)) return true;
    if (Array.isArray(message.content) && message.content.some(part =>
      part && typeof part === 'object' && nonblank(part.text))) return true;
    if (Array.isArray(message.tool_calls) && message.tool_calls.some(call => {
      if (!call || typeof call !== 'object') return false;
      return nonblank(call.id) || nonblank(call.function?.name) || nonblank(call.function?.arguments);
    })) return true;
    const call = message.function_call as Record<string, unknown> | undefined;
    return !!call && (nonblank(call.name) || nonblank(call.arguments));
  });
}
