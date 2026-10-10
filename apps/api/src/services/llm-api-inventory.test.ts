import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../store/persistence';
import { deleteLlmApi, getEnabledLlmApiConfigs, getLlmApiConfig, getMainRouterConfigs, getMainReasoningEffort, listLlmApis, selectLlmApi, setMainReasoningEffort, upsertLlmApi } from './llm-api-inventory';
import { withPhoneTextModel } from './llm-scope';
import { getRouter, resetRouter } from '../llm/create-router';

function apiEntry(id: string, apiKey: string) {
  const now = new Date().toISOString();
  return {
    id,
    name: id,
    protocol: 'openai-compatible' as const,
    baseUrl: 'https://example.test/v1',
    model: 'test-model',
    apiKey,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  };
}

describe('llm api inventory sidecar task routing', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('routes only configured sidecar tasks to their dedicated API entry', () => {
    store.state().llmApiInventory = {
      entries: {
        main: apiEntry('main', 'main-key-1234567890'),
        sidecar: apiEntry('sidecar', 'sidecar-key-1234567890'),
        task: apiEntry('task', 'task-key-1234567890'),
      },
      mainApiId: 'main',
      sidecarApiId: 'sidecar',
      sidecarTaskApiIds: { preferenceRecorder: 'task', quotaEnding: 'task', contextCompressor: 'task' },
    };

    expect(getLlmApiConfig('sidecar', 'preferenceRecorder')?.id).toBe('task');
    expect(getLlmApiConfig('sidecar', 'quotaEnding')?.id).toBe('task');
    expect(getLlmApiConfig('sidecar', 'contextCompressor')?.id).toBe('task');
    expect(getLlmApiConfig('sidecar', 'atmosphereJudge')?.id).toBe('sidecar');
    expect(getLlmApiConfig('sidecar', 'outputStructurer')?.id).toBe('sidecar');
    expect(getLlmApiConfig('sidecar')?.id).toBe('sidecar');
  });

  it('does not let ordinary sidecar fallback consume task-only entries', () => {
    store.state().llmApiInventory = {
      entries: {
        task: apiEntry('task', 'task-key-1234567890'),
      },
      mainApiId: null,
      sidecarApiId: null,
      sidecarTaskApiIds: { preferenceRecorder: 'task' },
    };

    expect(getLlmApiConfig('sidecar', 'preferenceRecorder')?.id).toBe('task');
    expect(getLlmApiConfig('sidecar')).toBeNull();
    expect(getLlmApiConfig('sidecar', 'atmosphereJudge')).toBeNull();
    expect(getLlmApiConfig('main')).toBeNull();
    expect(getEnabledLlmApiConfigs()).toEqual([]);
  });

  it('never silently falls back to a non-designated ready entry', () => {
    // sidecar 指定条目不就绪，但库里还有别的就绪条目（如 glm 扩展条目）。
    // 强约束下必须返回 null（显式降级），绝不偷偷改用 extra 条目。
    store.state().llmApiInventory = {
      entries: {
        sidecar: { ...apiEntry('sidecar', ''), enabled: false },
        extra: apiEntry('extra', 'extra-key-1234567890'),
      },
      mainApiId: null,
      sidecarApiId: 'sidecar',
      sidecarTaskApiIds: {},
    };

    expect(getLlmApiConfig('sidecar')).toBeNull();
    expect(getLlmApiConfig('sidecar', 'outputStructurer')).toBeNull();
    expect(getLlmApiConfig('main')).toBeNull();
  });

  it('falls back from an unavailable task binding to the designated sidecar default only', () => {
    store.state().llmApiInventory = {
      entries: {
        sidecar: apiEntry('sidecar', 'sidecar-key-1234567890'),
        task: { ...apiEntry('task', ''), enabled: false },
        extra: apiEntry('extra', 'extra-key-1234567890'),
      },
      mainApiId: null,
      sidecarApiId: 'sidecar',
      sidecarTaskApiIds: { outputStructurer: 'task' },
    };

    // task 绑定不就绪 → 落到 sidecar 默认，而不是任意就绪的 extra
    expect(getLlmApiConfig('sidecar', 'outputStructurer')?.id).toBe('sidecar');
  });

  it('builds the main router from only the selected ready main entry', () => {
    store.state().llmApiInventory = {
      entries: {
        main: apiEntry('main', 'main-key-1234567890'),
        sidecar: apiEntry('sidecar', 'sidecar-key-1234567890'),
        task: apiEntry('task', 'task-key-1234567890'),
      },
      mainApiId: 'main',
      sidecarApiId: 'sidecar',
      sidecarTaskApiIds: { preferenceRecorder: 'task' },
    };

    expect(getMainRouterConfigs().map((entry) => entry.id)).toEqual(['main']);
  });

  it('fails closed when the selected main entry is unavailable', () => {
    const disabled = apiEntry('main', '');
    store.state().llmApiInventory = {
      entries: {
        main: { ...disabled, enabled: false },
        sidecar: apiEntry('sidecar', 'sidecar-key-1234567890'),
      },
      mainApiId: 'main',
      sidecarApiId: 'sidecar',
      sidecarTaskApiIds: {},
    };

    expect(getMainRouterConfigs()).toEqual([]);
  });

  it('seeds NVIDIA as env-main when it is the only configured production key', () => {
    const oldEnv = {
      ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
      OPENAI_API_KEY: process.env.OPENAI_API_KEY,
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY,
      NVIDIA_API_KEY: process.env.NVIDIA_API_KEY,
      NVIDIA_MODEL: process.env.NVIDIA_MODEL,
      NVIDIA_DEFAULT_MODEL: process.env.NVIDIA_DEFAULT_MODEL,
    };
    try {
      process.env.ANTHROPIC_API_KEY = '';
      process.env.OPENAI_API_KEY = '';
      process.env.DEEPSEEK_API_KEY = '';
      process.env.NVIDIA_API_KEY = 'nvapi-test-key-1234567890';
      process.env.NVIDIA_MODEL = 'z-ai/glm-5.1';
      delete process.env.NVIDIA_DEFAULT_MODEL;

      expect(getMainRouterConfigs()).toEqual([
        expect.objectContaining({
          id: 'env-main',
          protocol: 'nvidia',
          baseUrl: 'https://integrate.api.nvidia.com/v1',
          model: 'z-ai/glm-5.1',
        }),
      ]);
      expect(store.state().llmApiInventory.mainApiId).toBe('env-main');
    } finally {
      for (const [key, value] of Object.entries(oldEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });
});

describe('phone text model selection', () => {
  beforeEach(() => {
    store.__resetForTests(); resetRouter();
    store.state().llmApiInventory = {
      entries: { main: apiEntry('main', 'main-test-key-12345'), sidecar: apiEntry('sidecar', 'sidecar-test-key-12345'), phone: { ...apiEntry('phone', 'phone-test-key-12345'), model: 'gemini-3.5-flash-lite' } },
      mainApiId: 'main', sidecarApiId: 'sidecar', phoneApiId: 'phone', sidecarTaskApiIds: { preferenceRecorder: 'sidecar' },
    };
  });
  it('uses one phone entry for main and every sidecar task within phone scope', () => {
    expect(getLlmApiConfig('phone')?.id).toBe('phone');
    withPhoneTextModel(() => {
      expect(getLlmApiConfig('main')?.id).toBe('phone');
      for (const task of ['outputStructurer', 'preferenceRecorder', 'quotaEnding', 'contextCompressor', 'atmosphereJudge'] as const) expect(getLlmApiConfig('sidecar', task)?.id).toBe('phone');
      expect(getMainRouterConfigs().map(entry => entry.id)).toEqual(['phone']);
    });
    expect(getLlmApiConfig('main')?.id).toBe('main');
    expect(getLlmApiConfig('sidecar', 'preferenceRecorder')?.id).toBe('sidecar');
  });
  it('isolates parallel asynchronous phone work from ordinary chat and router caches', async () => {
    const normal = getRouter();
    const phone = await withPhoneTextModel(async () => {
      await Promise.resolve();
      expect(getLlmApiConfig('sidecar')?.id).toBe('phone');
      return getRouter();
    });
    expect(phone).not.toBe(normal);
    expect(phone.getMainModel()).toBe('gemini-3.5-flash-lite');
    expect(getRouter()).toBe(normal);
    expect(getRouter().getMainModel()).toBe('test-model');
  });
  it('fails closed when a phone entry is disabled, removed or explicitly unbound', () => {
    store.state().llmApiInventory.entries.phone!.enabled = false;
    expect(withPhoneTextModel(() => getLlmApiConfig('sidecar'))).toBeNull();
    expect(withPhoneTextModel(getMainRouterConfigs)).toEqual([]);
    deleteLlmApi('phone');
    expect(getLlmApiConfig('phone')).toBeNull();
    expect(store.state().llmApiInventory.mainApiId).toBe('main');
    expect(store.state().llmApiInventory.sidecarApiId).toBe('sidecar');
  });
  it('supports legacy state, persists an independent selection and keeps keys masked', () => {
    delete store.state().llmApiInventory.phoneApiId;
    expect(getLlmApiConfig('phone')?.id).toBe('main');
    selectLlmApi('phone', 'phone');
    expect(listLlmApis().phoneApiId).toBe('phone');
    expect(listLlmApis().entries.every(entry => entry.apiKey === '')).toBe(true);
    expect(store.state().llmApiInventory.mainApiId).toBe('main');
    selectLlmApi('phone', null);
    expect(getLlmApiConfig('phone')).toBeNull();
  });
});

describe('upsertLlmApi id 生成', () => {
  beforeEach(() => {
    store.__resetForTests();
    for (const key of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'NVIDIA_API_KEY', 'SIDECAR_API_KEY', 'SIDECAR_TASK_API_KEY', 'SIDECAR_AUX_API_KEY']) vi.stubEnv(key, '');
  });
  afterEach(() => vi.unstubAllEnvs());

  const base = { name: 'x', protocol: 'openai-compatible' as const, model: 'm', apiKey: 'k' };

  it('显式 id 清洗后为空（纯中文）不再写出 entries[""]，而是回退到自动 id', () => {
    const entry = upsertLlmApi({ ...base, id: '偏好及上下文', name: '偏好及上下文' });
    expect(entry.id).not.toBe('');
    expect(entry.id.length).toBeGreaterThan(0);
    expect(store.state().llmApiInventory.entries['']).toBeUndefined();
    expect(store.state().llmApiInventory.entries[entry.id]).toBeDefined();
  });

  it('合法显式 id 命中现有条目时按编辑语义 upsert，不追加后缀', () => {
    const first = upsertLlmApi({ ...base, id: 'pref-context', model: 'a' });
    const second = upsertLlmApi({ ...base, id: 'pref-context', model: 'b' });
    expect(first.id).toBe('pref-context');
    expect(second.id).toBe('pref-context');
    expect(second.model).toBe('b');
    expect(Object.keys(store.state().llmApiInventory.entries)).toEqual(['pref-context']);
  });

  it('无显式 id 时自动生成，且重名追加后缀避免覆盖', () => {
    const a = upsertLlmApi({ ...base, name: 'deepseek' });
    const b = upsertLlmApi({ ...base, name: 'deepseek' });
    expect(a.id).not.toBe(b.id);
    expect(Object.keys(store.state().llmApiInventory.entries)).toHaveLength(2);
  });
});

describe('main reasoning effort', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('默认普通/暗号场景都是 low', () => {
    expect(getMainReasoningEffort('normal')).toBe('low');
    expect(getMainReasoningEffort('cipher')).toBe('low');
  });

  it('两个场景可独立设档并持久化到 inventory', () => {
    setMainReasoningEffort('normal', 'minimal');
    setMainReasoningEffort('cipher', 'high');
    expect(getMainReasoningEffort('normal')).toBe('minimal');
    expect(getMainReasoningEffort('cipher')).toBe('high');
    const inv = store.state().llmApiInventory;
    expect(inv.mainReasoningEffort).toBe('minimal');
    expect(inv.mainReasoningEffortCipher).toBe('high');
  });
});
