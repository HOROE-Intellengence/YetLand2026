import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import {
  AdminLlmApiSchema,
  AdminLlmApiSelectSchema,
  AdminLlmApiSelectTaskSchema,
  AdminLlmApiTestSchema,
  AdminLlmReasoningEffortSchema,
} from '@yelan/shared';
import { deleteLlmApi, listLlmApis, selectLlmApi, selectSidecarTaskApi, setMainReasoningEffort, upsertLlmApi } from '../../services/llm-api-inventory';
import { createAnthropicProvider, createOpenAILikeProvider, createNvidiaUnlimProvider } from '@yelan/llm';
import { resetRouter } from '../../llm/create-router';
import { audit } from './_audit';
import { validationHook } from '../../middleware/validation';
import { store } from '../../store/persistence';

export const adminLlmApisRoute = new Hono();

function providerFor(input: {
  id: string;
  protocol: 'openai-compatible' | 'anthropic' | 'nvidia';
  apiKey: string;
  baseUrl: string;
  model: string;
}) {
  if (input.protocol === 'anthropic') {
    return createAnthropicProvider(input.apiKey, { name: input.id, baseUrl: input.baseUrl, model: input.model });
  }
  if (input.protocol === 'nvidia') {
    return createNvidiaUnlimProvider(input.apiKey, { name: input.id, baseUrl: input.baseUrl, model: input.model });
  }
  return createOpenAILikeProvider({
    apiKey: input.apiKey,
    name: input.id,
    baseUrl: input.baseUrl,
    defaultModel: input.model,
  });
}

adminLlmApisRoute.get('/', (c) => c.json(listLlmApis()));

adminLlmApisRoute.post(
  '/',
  zValidator('json', AdminLlmApiSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const entry = upsertLlmApi(body);
    resetRouter();
    audit('llm-api.upsert', entry.id, body.reason, {
      name: entry.name,
      protocol: entry.protocol,
      baseUrl: entry.baseUrl,
      model: entry.model,
      enabled: entry.enabled,
    });
    return c.json({ ok: true, entry: { ...entry, apiKey: '' } });
  },
);

adminLlmApisRoute.delete('/:id', async (c) => {
  const reason = c.req.query('reason') || 'delete api entry';
  const id = c.req.param('id');
  const ok = deleteLlmApi(id);
  if (!ok) return c.json({ code: 'NOT_FOUND', message: 'api entry not found' }, 404);
  resetRouter();
  audit('llm-api.delete', id, reason);
  return c.json({ ok: true });
});

adminLlmApisRoute.post(
  '/select',
  zValidator('json', AdminLlmApiSelectSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    try {
      selectLlmApi(body.role, body.id);
    } catch (e) {
      return c.json({ code: 'NOT_FOUND', message: (e as Error).message }, 404);
    }
    resetRouter();
    audit('llm-api.select', body.id ?? body.role, body.reason, { role: body.role });
    return c.json({ ok: true });
  },
);

adminLlmApisRoute.post(
  '/select-task',
  zValidator('json', AdminLlmApiSelectTaskSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    try {
      selectSidecarTaskApi(body.taskKey, body.id);
    } catch (e) {
      return c.json({ code: 'NOT_FOUND', message: (e as Error).message }, 404);
    }
    audit('llm-api.select-sidecar-task', body.id ?? body.taskKey, body.reason, { taskKey: body.taskKey });
    return c.json({ ok: true });
  },
);

adminLlmApisRoute.post(
  '/reasoning-effort',
  zValidator('json', AdminLlmReasoningEffortSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    setMainReasoningEffort(body.scenario, body.effort);
    resetRouter();
    audit('llm-api.reasoning-effort', body.scenario, body.reason, { effort: body.effort });
    return c.json({ ok: true });
  },
);

adminLlmApisRoute.post(
  '/test',
  zValidator('json', AdminLlmApiTestSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const provider = providerFor({
      id: body.id ?? 'test-api',
      protocol: body.protocol,
      apiKey: body.apiKey.trim() || (body.id ? store.state().llmApiInventory.entries[body.id]?.apiKey : '') || '',
      baseUrl: body.baseUrl ?? '',
      model: body.model,
    });
    if (!provider.ready) return c.json({ ok: false, error: 'API key missing' }, 400);
    try {
      const t0 = Date.now();
      const result = await provider.complete({
        model: body.model,
        messages: [
          { role: 'system', content: '你是一个简短回答的中文助手。' },
          { role: 'user', content: '用一句话回答：今晚月色如何？' },
        ],
        maxTokens: 64,
        temperature: 0.3,
      });
      return c.json({ ok: true, latencyMs: Date.now() - t0, sample: result.text });
    } catch (e) {
      return c.json({ ok: false, error: (e as Error).message }, 500);
    }
  },
);
