import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../store/persistence';
import { adminSidecarConfigRoute } from './sidecar-config';

describe('admin sidecar-config route', () => {
  beforeEach(() => {
    store.__resetForTests();
  });

  // ── GET ─────────────────────────────────────────────────────
  it('GET returns enabled, order, effectiveOrder, runtimeNotes', async () => {
    const res = await adminSidecarConfigRoute.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body).toHaveProperty('enabled');
    expect(body).toHaveProperty('order');
    expect(body).toHaveProperty('effectiveOrder');
    expect(body).toHaveProperty('runtimeNotes');
    expect(body.order).toHaveLength(5);
    expect(body.effectiveOrder).toHaveLength(5);
    expect(Object.keys(body.enabled)).toHaveLength(5);
  });

  // ── PATCH enabled ───────────────────────────────────────────
  it('PATCH disables a single sidecar', async () => {
    const res = await adminSidecarConfigRoute.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: { contextCompressor: false }, reason: 'test disable' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.enabled.contextCompressor).toBe(false);
    expect(body.effectiveOrder).not.toContain('contextCompressor');
    expect(body.effectiveOrder).toHaveLength(4);
  });

  it('PATCH disables all sidecars', async () => {
    const res = await adminSidecarConfigRoute.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: {
          atmosphereJudge: false,
          outputStructurer: false,
          preferenceRecorder: false,
          quotaEnding: false,
          contextCompressor: false,
        },
        reason: 'test disable all',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.effectiveOrder).toEqual([]);
  });

  // ── PATCH order — 拒绝脏数据 ──────────────────────────────
  it('PATCH rejects duplicate order with 400', async () => {
    const res = await adminSidecarConfigRoute.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        order: ['atmosphereJudge', 'atmosphereJudge', 'atmosphereJudge', 'atmosphereJudge', 'atmosphereJudge'],
        reason: 'test bad order',
      }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe('INVALID_ORDER');
  });

  it('PATCH rejects short order with 400', async () => {
    const res = await adminSidecarConfigRoute.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: ['atmosphereJudge', 'outputStructurer'], reason: 'test short' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.code).toBe('INVALID_ORDER');
  });

  it('PATCH accepts valid order permutation', async () => {
    const perm = ['contextCompressor', 'quotaEnding', 'preferenceRecorder', 'atmosphereJudge', 'outputStructurer'];
    const res = await adminSidecarConfigRoute.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ order: perm, reason: 'test valid permutation' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok).toBe(true);
    expect(body.order).toEqual(perm);
  });

  // ── PATCH 缺少 reason ──────────────────────────────────────
  it('PATCH rejects requests without reason', async () => {
    const res = await adminSidecarConfigRoute.request('/', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: { contextCompressor: false } }),
    });
    expect(res.status).toBe(400);
  });

  // ── 脏 order 自动修复 ──────────────────────────────────────
  it('GET returns clean order even after dirty state is injected', async () => {
    (store.state() as any).sidecarOrder = ['a', 'b', 'c'];
    const res = await adminSidecarConfigRoute.request('/');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.order).toHaveLength(5);
    expect(new Set(body.order).size).toBe(5);
  });
});
