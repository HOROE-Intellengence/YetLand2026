import { afterEach, expect, it, vi } from 'vitest';
import { adminMaterialsRoute } from './materials';
vi.mock('../../services/image-materials',()=>({imageMaterials:()=>({
  list:(_page:number,_user?:string,source?:string)=>({items:[],total:0,source}),
  get:(id:string)=>id==='retained'?{id,mime:'application/json',fileName:'合成资源.json',data:Buffer.from('{"complete":true}')}:undefined,
})}));
afterEach(()=>vi.unstubAllEnvs());
it('protects complete files and streams their original bytes with private isolation headers',async()=>{
  vi.stubEnv('ADMIN_TOKEN','materials-admin-test');
  for(const path of ['/','/retained/content'])for(const token of ['', 'Bearer user-token'])expect((await adminMaterialsRoute.request(path,{headers:{Authorization:token}})).status).toBe(401);
  const headers={Authorization:'Bearer materials-admin-test'};
  const response=await adminMaterialsRoute.request('/retained/content?download=1',{headers});
  expect(response.status).toBe(200);expect(await response.text()).toBe('{"complete":true}');
  expect(response.headers.get('content-type')).toBe('application/json');
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('content-security-policy')).toContain('sandbox');
  expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  expect(response.headers.get('content-disposition')).toContain(encodeURIComponent('合成资源.json'));
  expect((await adminMaterialsRoute.request('/missing/content',{headers})).status).toBe(404);
});
