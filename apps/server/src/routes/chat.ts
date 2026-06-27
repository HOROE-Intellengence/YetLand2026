// POST /api/chat — SSE 流式对话主入口
// 链路: validate → moderation → boundary → stage → recall(client→header) → assemble prompt → LLMRouter.stream → cost-tracker
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { ChatRequestSchema } from '@yelan/shared';
import type { Env } from '../types/bindings';
import { requireAuth } from '../middleware/auth';
import { handleChatTurn } from '../pipeline/handle-chat-turn';

export const chatRoute = new Hono<{ Bindings: Env }>();

chatRoute.use('*', requireAuth());

chatRoute.post('/', (c) => {
  return streamSSE(c, async (stream) => {
    const body = ChatRequestSchema.parse(await c.req.json());
    for await (const event of handleChatTurn(c.env, c.get('userId') as string, body)) {
      await stream.writeSSE({ data: JSON.stringify(event) });
    }
  });
});
