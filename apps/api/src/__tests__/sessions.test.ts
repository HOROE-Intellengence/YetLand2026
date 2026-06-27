import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { mockSessionsRoute } from '../routes/sessions';

describe('POST /api/sessions', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('creates a default main session when body is omitted', async () => {
    const res = await mockSessionsRoute.request('/', { method: 'POST' });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      id: string;
      characterId: string;
      mode: string;
      ifActive?: boolean;
    };
    expect(body.characterId).toBe('shen-yan-zhi');
    expect(body.mode).toBe('main');
    expect(body.ifActive).toBe(false);
    expect(store.state().sessions[body.id]).toMatchObject({
      characterId: 'shen-yan-zhi',
      mode: 'main',
    });
  });

  it('rejects invalid session create payloads', async () => {
    const res = await mockSessionsRoute.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'side-story' }),
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error?: string };
    expect(body.error).toBe('VALIDATION_ERROR');
  });
});
