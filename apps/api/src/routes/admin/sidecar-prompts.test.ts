import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../store/persistence';
import { getDefaultPrompt } from '../../sidecar-ai/prompts';
import { adminSidecarPromptsRoute } from './sidecar-prompts';

describe('admin sidecar-prompts route', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('DELETE resets a configured prompt back to its default', async () => {
    store.state().sidecarPrompts.outputStructurer = 'custom prompt';

    const res = await adminSidecarPromptsRoute.request('/outputStructurer?reason=test%20reset', {
      method: 'DELETE',
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      key: 'outputStructurer',
      value: getDefaultPrompt('outputStructurer'),
      reset: true,
    });
    expect(store.state().sidecarPrompts.outputStructurer).toBeUndefined();
    expect(store.state().adminAudit.at(-1)).toMatchObject({
      action: 'sidecar-prompts.reset',
      target: 'outputStructurer',
      reason: 'test reset',
    });
  });

  it('DELETE rejects unknown prompt keys', async () => {
    const res = await adminSidecarPromptsRoute.request('/unknown?reason=test%20reset', {
      method: 'DELETE',
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'INVALID_KEY' });
  });
});
