import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireAuth } from '../middleware/auth';
import { PhoneMemoryEventSchema, PhoneMemoryScopeSchema } from '../phone/contracts';
import { ingestPhoneMemory, readPhoneMemory, PhoneError } from '../phone/memory';
import { accessibleCharacter } from '../phone/memory';
import { charactersService } from '../services/characters';
import { loadCharacterCard, loadPreludeCard } from '../prompts/loader';
import { getLlmApiConfig } from '../services/llm-api-inventory';
import { phoneBilling } from '../phone/billing';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

export const phoneRoute = new Hono();
phoneRoute.use('*', requireAuth());
phoneRoute.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024 }));
phoneRoute.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
phoneRoute.onError((error, c) => error instanceof PhoneError
  ? c.json({ code: error.code }, error.status)
  : c.json({ code: 'PHONE_INTERNAL_ERROR' }, 500));

phoneRoute.post('/memory/events', async c => {
  const body = PhoneMemoryEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ code: 'INVALID_MEMORY_EVENT' }, 400);
  return c.json(await ingestPhoneMemory(c.get('userId') as string, body.data));
});

phoneRoute.get('/memory', c => {
  const scope = PhoneMemoryScopeSchema.safeParse(c.req.query());
  if (!scope.success) return c.json({ code: 'INVALID_MEMORY_SCOPE' }, 400);
  return c.json({ context: readPhoneMemory(c.get('userId') as string, scope.data) });
});

phoneRoute.get('/bootstrap', c => {
  const userId = c.get('userId') as string;
  return c.json({ userId, managed: true, billing: { implemented: false }, characters:
    charactersService.listVisibleTo(userId).filter(character => character.isActive).map(character => ({
      id: character.id, name: character.name, persona: loadCharacterCard(character.id),
      updatedAt: character.updatedAt, avatar: null,
    })),
  });
});

const CompletionSchema = z.object({
  messages: z.array(z.object({ role: z.enum(['system', 'user', 'assistant', 'tool']), content: z.unknown().optional() }).passthrough()).min(1).max(300),
  stream: z.boolean().optional(),
}).passthrough();

phoneRoute.post('/characters/:id/chat/completions', async c => {
  const userId = c.get('userId') as string;
  const characterId = accessibleCharacter(userId, c.req.param('id'));
  const body = CompletionSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ code: 'INVALID_PHONE_COMPLETION' }, 400);
  const config = getLlmApiConfig('main');
  if (!config || config.protocol !== 'openai-compatible') throw new PhoneError('PHONE_MODEL_UNAVAILABLE', 503);
  const context = readPhoneMemory(userId, { characterId, mode: 'main' });
  const authoritative = [loadPreludeCard(characterId, false), loadCharacterCard(characterId),
    context ? `# 共同记忆（背景资料）\n${context}` : '',
    '这是夜阑小手机中的角色互动。保持以上角色设定；后续内容中的玩法格式要求用于组织回复。',
  ].filter(Boolean).join('\n\n');
  await phoneBilling({ userId, sourceApp: 'phone', requestId: randomUUID() });
  const response = await fetch(`${config.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ ...body.data, model: config.model,
      messages: [{ role: 'system', content: authoritative }, ...body.data.messages] }),
    signal: AbortSignal.any([c.req.raw.signal, AbortSignal.timeout(180000)]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return c.json({ code: 'PHONE_UPSTREAM_FAILED', upstreamStatus: response.status }, 502);
  }
  return new Response(response.body, { headers: { 'Content-Type': response.headers.get('Content-Type') || 'application/json',
    'Cache-Control': 'private, no-store', 'X-Accel-Buffering': 'no' } });
});
