import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../store/persistence';
import { adminHealthRoute } from './health';

describe('admin health route', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  it('exposes sidecar readiness metadata', async () => {
    const res = await adminHealthRoute.request('/');
    const body = await res.json() as { sidecar?: { ready?: unknown; model?: unknown; baseUrl?: unknown } };

    expect(res.status).toBe(200);
    expect(typeof body.sidecar?.ready).toBe('boolean');
    expect(typeof body.sidecar?.model).toBe('string');
    expect(typeof body.sidecar?.baseUrl).toBe('string');
  });
});
