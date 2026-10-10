import { afterEach, expect, it, vi } from 'vitest';
import { adminPhoneInspectionsRoute } from './phone-inspections';
vi.mock('../../phone/inspection', () => ({ phoneInspections: () => ({ list: () => ({ items: [], total: 0, pageSize: 30 }), get: () => undefined }) }));
afterEach(() => vi.unstubAllEnvs());
it('restricts operations inspection to admin credentials and exposes no write API', async () => {
  vi.stubEnv('ADMIN_TOKEN', 'inspection-admin-test');
  for (const path of ['/', '/worldviews', '/record-id']) {
    for (const token of ['', 'Bearer user-token']) expect((await adminPhoneInspectionsRoute.request(path, { headers: { Authorization: token } })).status).toBe(401);
  }
  const headers = { Authorization: 'Bearer inspection-admin-test' };
  const response = await adminPhoneInspectionsRoute.request('/', { headers });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect((await adminPhoneInspectionsRoute.request('/?page=0', { headers })).status).toBe(400);
  expect((await adminPhoneInspectionsRoute.request('/?kind=apiKeys', { headers })).status).toBe(400);
  expect((await adminPhoneInspectionsRoute.request('/record-id', { method: 'PUT', headers, body: '{}' })).status).toBe(404);
});
