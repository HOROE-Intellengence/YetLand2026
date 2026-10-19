import { afterEach, expect, it, vi } from 'vitest';
import { adminPhoneInspectionsRoute } from './phone-inspections';
vi.mock('../../phone/inspection', () => ({ phoneInspections: () => ({ list: () => ({ items: [], total: 0, pageSize: 30, owners: [] }), owners: () => [], get: () => undefined,getAsset:(key:string,id:string)=>key==='record'&&id==='f'.repeat(64)?{mime:'audio/wav',data:Buffer.from('private-media')}:null }) }));
afterEach(() => vi.unstubAllEnvs());
it('restricts operations inspection to admin credentials and exposes no write API', async () => {
  vi.stubEnv('ADMIN_TOKEN', 'inspection-admin-test');
  for (const path of ['/', '/worldviews', '/record-id','/record-id/assets/'+ 'f'.repeat(64)]) {
    for (const token of ['', 'Bearer user-token']) expect((await adminPhoneInspectionsRoute.request(path, { headers: { Authorization: token } })).status).toBe(401);
  }
  const headers = { Authorization: 'Bearer inspection-admin-test' };
  const response = await adminPhoneInspectionsRoute.request('/', { headers });
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect((await adminPhoneInspectionsRoute.request('/?page=0', { headers })).status).toBe(400);
  expect((await adminPhoneInspectionsRoute.request('/?kind=apiKeys', { headers })).status).toBe(400);
  expect((await adminPhoneInspectionsRoute.request('/record-id', { method: 'PUT', headers, body: '{}' })).status).toBe(404);
});
it('serves linked media through the authenticated read-only route with private cache and isolation headers',async()=>{
  vi.stubEnv('ADMIN_TOKEN','inspection-admin-test');
  const headers={Authorization:'Bearer inspection-admin-test'};
  const response=await adminPhoneInspectionsRoute.request('/record/assets/'+'f'.repeat(64),{headers});
  expect(response.status).toBe(200);expect(await response.text()).toBe('private-media');
  expect(response.headers.get('content-type')).toBe('audio/wav');expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('content-security-policy')).toContain('sandbox');
  expect((await adminPhoneInspectionsRoute.request('/another/assets/'+'f'.repeat(64),{headers})).status).toBe(404);
});
