import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { LogsConversationRequestSchema, LogsConversationResponseSchema } from '@yelan/shared';
import { softAuth } from '../middleware/auth';
import { conversationLogRepo } from '../store/repositories';
import { validationHook } from '../middleware/validation';

export const mockLogsRoute = new Hono();
mockLogsRoute.use('*', softAuth());

mockLogsRoute.post(
  '/conversation',
  zValidator('json', LogsConversationRequestSchema, validationHook),
  async (c) => {
    const userId = c.get('userId') as string;
    const body = c.req.valid('json');
    await conversationLogRepo.append({ userId, sessionId: body.sessionId ?? 'unknown', payload: body });
    return c.json(LogsConversationResponseSchema.parse({ ok: true }));
  },
);
