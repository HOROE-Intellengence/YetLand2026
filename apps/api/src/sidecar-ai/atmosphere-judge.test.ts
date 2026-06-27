import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../store/persistence';
import { getTemperatureLog, judgeAtmosphere } from './atmosphere-judge';

function seedSidecarApi() {
  const now = new Date().toISOString();
  store.state().llmApiInventory = {
    entries: {
      sidecar: {
        id: 'sidecar',
        name: 'Sidecar',
        protocol: 'openai-compatible',
        baseUrl: 'https://example.test/v1',
        model: 'test-model',
        apiKey: 'sidecar-key-1234567890',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    },
    mainApiId: null,
    sidecarApiId: 'sidecar',
    sidecarTaskApiIds: {},
  };
}

describe('judgeAtmosphere timeout budget', () => {
  beforeEach(() => {
    store.__resetForTests();
    seedSidecarApi();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('allows a 3s sidecar response to complete and record temperature', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      setTimeout(() => {
        resolve(new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ temperature: 4 }) } }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }, 3000);
    })));

    const pending = judgeAtmosphere({
      characterName: '测试角色',
      characterPersonality: 'standard',
      boundary: 3,
      stage: 'daily',
      round: 1,
      ifActive: false,
      recentTemperatures: [],
      recentConversation: 'user: 你好',
      userInput: '靠近一点',
      maxTemperature: 5,
    }, 'session-slow-atmo');

    await vi.advanceTimersByTimeAsync(3000);

    await expect(pending).resolves.toEqual({ ok: true, data: { temperature: 4 } });
    expect(getTemperatureLog('session-slow-atmo')).toEqual([4]);
  });
});
