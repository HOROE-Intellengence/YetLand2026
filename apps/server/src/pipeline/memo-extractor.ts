import type { LLMProvider } from '@yelan/llm';

export interface ExtractedMemo {
  preferences: string[];
  events: { date: string; text: string; emotion?: string }[];
  relationshipState?: string;
}

const EXTRACT_PROMPT = `从以下对话中提取用户偏好和关键事件。输出 JSON：
{
  "preferences": ["偏好描述1", ...],
  "events": [{"date": "YYYY-MM-DD", "text": "描述", "emotion": "情绪"}],
  "relationshipState": "关系状态简述"
}`;

export async function extractMemo(
  provider: LLMProvider,
  recentTurns: string[],
): Promise<ExtractedMemo> {
  if (!provider.ready || recentTurns.length === 0) {
    return { preferences: [], events: [] };
  }

  try {
    const conversation = recentTurns.join('\n');
    const result = await provider.complete({
      model: '',
      messages: [
        { role: 'system', content: EXTRACT_PROMPT },
        { role: 'user', content: conversation.slice(0, 4000) },
      ],
      maxTokens: 512,
      temperature: 0.1,
    });

    const json = JSON.parse(result.text) as ExtractedMemo;
    return {
      preferences: Array.isArray(json.preferences) ? json.preferences : [],
      events: Array.isArray(json.events) ? json.events : [],
      relationshipState: json.relationshipState,
    };
  } catch {
    return { preferences: [], events: [] };
  }
}
