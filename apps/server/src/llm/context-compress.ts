import type { LLMProvider } from '@yelan/llm';

export async function compressContext(
  _provider: LLMProvider,
  _conversation: string,
): Promise<{ summary: string }> {
  // TODO: 切尾保留最近 N 轮，把更早的丢给 cheapProvider 摘要成 200 字 system 注入
  return { summary: '' };
}
