import { beforeEach, describe, expect, it } from 'vitest';
import { store } from '../../store/persistence';
import { adminAuditRoute } from './audit';

describe('admin audit route', () => {
  beforeEach(() => {
    store.__resetForTests();
    for (let i = 0; i < 60; i++) {
      store.state().adminAudit.push({
        id: `aud_${i}`,
        ts: `2026-05-12T00:${String(i).padStart(2, '0')}:00.000Z`,
        action: i % 3 === 0 ? 'character.create' : i % 3 === 1 ? 'policy.update' : 'candle.grant',
        actor: 'admin',
      });
    }
  });

  it('filters action groups by prefix', async () => {
    const res = await adminAuditRoute.request('/?action=character');
    const body = await res.json() as { rows: { action: string }[]; total: number };

    expect(res.status).toBe(200);
    expect(body.total).toBe(20);
    expect(body.rows).toHaveLength(20);
    expect(body.rows[0]?.action).toBe('character.create');
  });

  it('supports limit + offset pagination', async () => {
    const res = await adminAuditRoute.request('/?limit=10&offset=5');
    const body = await res.json() as { rows: { action: string }[]; total: number };

    expect(res.status).toBe(200);
    expect(body.total).toBe(60);
    expect(body.rows).toHaveLength(10);
  });
});
