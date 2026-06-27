import { beforeEach, describe, expect, it } from 'vitest';
import { getDefaultConstellation } from '@yelan/shared';
import { store } from '../../store/persistence';
import { charactersService } from '../../services/characters';
import { constellationsService } from '../../services/constellations';
import { adminConstellationsRoute } from './constellations';
import { mockCharactersRoute } from '../characters';

const SLUG = 'shen-yan-zhi';

function put(slug: string, body: Record<string, unknown>) {
  return adminConstellationsRoute.request(`/${slug}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const customBody = {
  points: [
    { id: 'A', x: 50, y: -10 },
    { id: 'B', x: 30, y: 30 },
    { id: 'C', x: 70, y: 30 },
  ],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C' },
  ],
  reason: '测试自定义星座',
};

describe('admin constellations route', () => {
  beforeEach(() => {
    store.__resetForTests();
    charactersService.resetFromYaml(); // seed shen-yan-zhi / jiang-bai into fresh state
  });

  it('GET /:slug returns the built-in default with source=default when nothing persisted', async () => {
    const res = await adminConstellationsRoute.request(`/${SLUG}`);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { slug: string; source: string; points: unknown[] };
    expect(json.slug).toBe(SLUG);
    expect(json.source).toBe('default');
    expect(json.points).toHaveLength(getDefaultConstellation(SLUG).points.length);
  });

  it('PUT /:slug persists a custom constellation and flips source to custom', async () => {
    const res = await put(SLUG, customBody);
    expect(res.status).toBe(200);
    const json = (await res.json()) as { source: string; points: unknown[] };
    expect(json.source).toBe('custom');
    expect(json.points).toHaveLength(3);
    expect(store.state().constellations[SLUG]).toBeTruthy();
    // 写入落审计
    expect(store.state().adminAudit.at(-1)?.action).toBe('constellation.update');

    // 再 GET 应读到自定义数据
    const after = await adminConstellationsRoute.request(`/${SLUG}`);
    const aj = (await after.json()) as { source: string; points: unknown[] };
    expect(aj.source).toBe('custom');
    expect(aj.points).toHaveLength(3);
  });

  it('PUT rejects a slug with no matching character (404)', async () => {
    const res = await put('no-such-character', customBody);
    expect(res.status).toBe(404);
  });

  it('PUT rejects malformed data (edge referencing unknown point) with 400', async () => {
    const res = await put(SLUG, {
      points: [{ id: 'A', x: 0, y: 0 }],
      edges: [{ from: 'A', to: 'Z' }],
      reason: 'bad',
    });
    expect(res.status).toBe(400);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe('VALIDATION_ERROR');
  });

  it('PUT rejects out-of-range coordinates with 400', async () => {
    const res = await put(SLUG, { points: [{ id: 'A', x: 999, y: 0 }], edges: [], reason: 'bad' });
    expect(res.status).toBe(400);
  });

  it('GET / lists only persisted (custom) constellations', async () => {
    await put(SLUG, customBody);
    const res = await adminConstellationsRoute.request('/');
    const json = (await res.json()) as { constellations: { slug: string; source: string }[] };
    expect(json.constellations).toHaveLength(1);
    expect(json.constellations[0]?.slug).toBe(SLUG);
    expect(json.constellations[0]?.source).toBe('custom');
  });

  it('DELETE /:slug resets to default and clears the persisted row', async () => {
    await put(SLUG, customBody);
    const del = await adminConstellationsRoute.request(`/${SLUG}?reason=reset`, { method: 'DELETE' });
    expect(del.status).toBe(200);
    expect(store.state().constellations[SLUG]).toBeUndefined();

    const after = await adminConstellationsRoute.request(`/${SLUG}`);
    const aj = (await after.json()) as { source: string };
    expect(aj.source).toBe('default');
  });

  it('DELETE returns 404 when there is no custom row to reset', async () => {
    const del = await adminConstellationsRoute.request(`/${SLUG}`, { method: 'DELETE' });
    expect(del.status).toBe(404);
  });
});

describe('public characters route — constellation join', () => {
  beforeEach(() => {
    store.__resetForTests();
    charactersService.resetFromYaml();
  });

  it('joins a built-in default constellation into every active character', async () => {
    const res = await mockCharactersRoute.request('/');
    const list = (await res.json()) as { slug: string; constellation?: { points: unknown[] } }[];
    expect(list.length).toBeGreaterThan(0);
    for (const ch of list) {
      expect(ch.constellation).toBeTruthy();
      expect(Array.isArray(ch.constellation?.points)).toBe(true);
    }
  });

  it('joins the persisted custom constellation once saved', async () => {
    constellationsService.upsert(SLUG, { points: customBody.points, edges: customBody.edges });
    const res = await mockCharactersRoute.request('/');
    const list = (await res.json()) as { slug: string; constellation?: { points: unknown[] } }[];
    const shen = list.find((c) => c.slug === SLUG);
    expect(shen?.constellation?.points).toHaveLength(3);
  });
});

describe('constellationsService.resolve', () => {
  beforeEach(() => store.__resetForTests());

  it('falls back to the built-in default when nothing persisted', () => {
    const c = constellationsService.resolve(SLUG);
    expect(c.points).toHaveLength(getDefaultConstellation(SLUG).points.length);
  });

  it('returns persisted data once upserted', () => {
    constellationsService.upsert(SLUG, { points: customBody.points, edges: customBody.edges });
    const c = constellationsService.resolve(SLUG);
    expect(c.points).toHaveLength(3);
  });
});
