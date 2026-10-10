import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { requireAuth } from '../middleware/auth';
import { PhoneMemoryEventSchema, PhoneMemoryScopeSchema, PhoneImageRequestSchema, PhoneSpeechRequestSchema,
  PhoneVoiceSessionRequestSchema, PhoneCompletionRequestSchema } from '@yelan/shared';
import { ingestPhoneMemory, readPhoneMemory, PhoneError } from '../phone/memory';
import { accessibleCharacter } from '../phone/memory';
import { charactersService } from '../services/characters';
import { loadCharacterCard, loadPreludeCard } from '../prompts/loader';
import { getLlmApiConfig } from '../services/llm-api-inventory';
import { phoneBilling } from '../phone/billing';
import { randomUUID } from 'node:crypto';
import { phoneRole, savePhoneRoleRules } from '../phone/role-rules';
import { store } from '../store/persistence';
import { VoiceError } from '../voice/config';
import { generateManagedImage, imageConfigured, ImageError } from '../services/managed-images';
import { PhoneInspectionRequestSchema } from '@yelan/shared';
import { phoneInspections } from '../phone/inspection';

export const phoneRoute = new Hono();
phoneRoute.use('*', requireAuth());
phoneRoute.use('*', bodyLimit({ maxSize: 4 * 1024 * 1024 }));
phoneRoute.use('*', async (c, next) => { c.header('Cache-Control', 'private, no-store'); await next(); });
phoneRoute.onError((error, c) => error instanceof ImageError ? c.json({ code: error.code }, error.status) : error instanceof VoiceError
  ? c.json({ code: error.code }, error.status as 400 | 403 | 404 | 409 | 422 | 429 | 500 | 502 | 503)
  : error instanceof PhoneError
  ? c.json({ code: error.code }, error.status)
  : c.json({ code: 'PHONE_INTERNAL_ERROR' }, 500));

phoneRoute.post('/inspection', async c => {
  const parsed = PhoneInspectionRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ code: 'INVALID_INSPECTION' }, 400);
  const userId = c.get('userId') as string;
  if (parsed.data.ownerUserId !== userId) return c.json({ code: 'INSPECTION_OWNER_MISMATCH' }, 403);
  return c.json(phoneInspections().ingest(userId, parsed.data));
});

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
  return c.json({ userId, managed: true, imageGeneration: imageConfigured(), billing: { implemented: false }, characters:
    charactersService.listVisibleTo(userId).filter(character => character.isActive).map(character => ({
      id: character.id, name: character.name, persona: character.description || '',
      updatedAt: character.updatedAt, avatar: null,
      ...phoneRole(userId, character.id),
    })),
  });
});

phoneRoute.post('/images/generations', async c => {
  const body = PhoneImageRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ code: 'INVALID_IMAGE_REQUEST' }, 400);
  const userId = c.get('userId') as string;
  if (body.data.characterId) accessibleCharacter(userId, body.data.characterId);
  return c.json(await generateManagedImage({ ...body.data, userId }, c.req.raw.signal));
});

phoneRoute.get('/characters/:id/rules', c => c.json(phoneRole(c.get('userId') as string, c.req.param('id'))));
phoneRoute.put('/characters/:id/rules', async c => c.json(savePhoneRoleRules(c.get('userId') as string,
  c.req.param('id'), await c.req.json().catch(() => null))));

phoneRoute.post('/voice/sessions', async c => {
  const body = PhoneVoiceSessionRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ code: 'INVALID_PHONE_VOICE' }, 400);
  const userId = c.get('userId') as string;
  const characterId = accessibleCharacter(userId, body.data.characterId);
  let session: { id: string };
  if (body.data.kind === 'voice-hq') {
    const { hqVoiceService } = await import('../voice-hq/service');
    session = hqVoiceService().create(userId, characterId);
  } else {
    const { voiceService } = await import('../voice/service');
    const service = voiceService(); await service.ready;
    session = service.create(userId, characterId);
  }
  (store.state().phoneVoiceSessions ??= {})[session.id] = {
    userId, characterId, mode: body.data.mode, branchId: body.data.branchId, context: body.data.context,
  };
  store.save();
  return c.json({ id: session.id, kind: body.data.kind }, 201);
});

phoneRoute.post('/characters/:id/speech', async c => {
  const userId = c.get('userId') as string;
  const characterId = accessibleCharacter(userId, c.req.param('id'));
  const body = PhoneSpeechRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ code: 'INVALID_SPEECH_TEXT' }, 400);
  const [{ synthesize }, { characterProfile }, { voiceDatabase }, { encodeOpus }] = await Promise.all([
    import('../voice-hq/providers'), import('../voice-hq/profiles'), import('../voice/database'), import('../voice/audio'),
  ]);
  const profile = characterProfile(voiceDatabase(), characterId);
  const pcm = await synthesize(body.data.text, profile, c.req.raw.signal);
  const audio = await encodeOpus(pcm, 24000);
  return new Response(new Uint8Array(audio), { headers: { 'Content-Type': 'audio/ogg', 'Cache-Control': 'private, no-store' } });
});

phoneRoute.post('/characters/:id/chat/completions', async c => {
  const userId = c.get('userId') as string;
  const characterId = accessibleCharacter(userId, c.req.param('id'));
  const body = PhoneCompletionRequestSchema.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ code: 'INVALID_PHONE_COMPLETION' }, 400);
  const config = getLlmApiConfig('phone');
  if (!config || config.protocol !== 'openai-compatible') throw new PhoneError('PHONE_MODEL_UNAVAILABLE', 503);
  let branchId: string | undefined;
  try {
    const header = c.req.header('x-yelan-memory-branch');
    branchId = header === undefined ? undefined : decodeURIComponent(header);
  } catch { return c.json({ code: 'INVALID_MEMORY_SCOPE' }, 400); }
  const scope = PhoneMemoryScopeSchema.safeParse({ characterId, mode: 'main', branchId });
  if (!scope.success) return c.json({ code: 'INVALID_MEMORY_SCOPE' }, 400);
  const context = readPhoneMemory(userId, scope.data);
  const authoritative = [loadPreludeCard(characterId, false), loadCharacterCard(characterId),
    context ? `# 共同记忆（背景资料）\n${context}` : '',
    '这是夜阑小手机中的角色互动。保持以上角色设定；后续内容中的玩法格式要求用于组织回复。',
  ].filter(Boolean).join('\n\n');
  await phoneBilling({ userId, sourceApp: 'phone', requestId: randomUUID() });
  const { phoneChatLogs } = await import('../phone/chat-logs');
  const { phoneChatStream } = await import('../phone/chat-stream');
  const logs = phoneChatLogs(), requestId = randomUUID(), started = Date.now();
  const messages = [{ role: 'system', content: authoritative }, ...body.data.messages];
  logs.start({ id: requestId, userId, characterId, branchId, model: config.model, messages });
  return phoneChatStream({ stream: Boolean(body.data.stream), signal: c.req.raw.signal,
    finish: (status, http, code, response, truncated) => logs.finish(requestId, status, Date.now() - started, http, code, response, truncated),
    perform: signal => fetch(`${config.baseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '')}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
    body: JSON.stringify({ ...body.data, model: config.model,
      messages }), signal,
    }),
  });
});
