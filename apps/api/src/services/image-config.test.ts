import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {store} from '../store/persistence';
import {imageConfig,publicImageConfig,saveImageConfig} from './image-config';
import {adminConfigRoute} from '../routes/admin/config';
import {generateManagedImage} from './managed-images';
beforeEach(()=>{store.__resetForTests();vi.stubEnv('ADMIN_TOKEN','test-admin-image');vi.stubEnv('IMAGE_API_KEY','existing-environment-secret');vi.stubEnv('IMAGE_API_BASE_URL','https://images.example/v1');});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});
it('inherits environment config without exposing its key',()=>{expect(publicImageConfig()).toMatchObject({hasKey:true,source:'environment'});expect(JSON.stringify(publicImageConfig())).not.toContain('existing-environment-secret');});
it('retains a blank key, normalizes full endpoint and persists one config',()=>{
 const save=vi.spyOn(store,'saveStrict');saveImageConfig({baseUrl:'https://new.example/v1/images/generations/',apiKey:'',enabled:true});
 expect(imageConfig()).toEqual({baseUrl:'https://new.example/v1',apiKey:'existing-environment-secret',enabled:true});expect(save).toHaveBeenCalled();
});
it('rolls back memory if persistence fails',()=>{vi.spyOn(store,'saveStrict').mockImplementation(()=>{throw Error('disk')});expect(()=>saveImageConfig({baseUrl:'https://new.example/v1',apiKey:'new-secret',enabled:true})).toThrow();expect(imageConfig().apiKey).toBe('existing-environment-secret');});
it('denies unauthenticated and ordinary callers',async()=>{
 for(const token of ['', 'ordinary-user'])for(const method of ['GET','PUT'])expect((await adminConfigRoute.request('/image',{method,headers:{Authorization:token}})).status).toBe(401);
});
it('validates URLs and never returns saved credentials',async()=>{
 const headers={Authorization:'Bearer test-admin-image','Content-Type':'application/json'};
 for(const baseUrl of ['http://images.example','https://user:pass@images.example','https://images.example?key=secret'])expect((await adminConfigRoute.request('/image',{method:'PUT',headers,body:JSON.stringify({baseUrl,enabled:true})})).status).toBe(400);
 const r=await adminConfigRoute.request('/image',{method:'PUT',headers,body:JSON.stringify({baseUrl:'https://new.example/v1',apiKey:'new-private-key',enabled:true})});expect(r.status).toBe(200);expect(await r.text()).not.toContain('new-private-key');
 const get=await adminConfigRoute.request('/image',{headers});expect(get.headers.get('cache-control')).toBe('private, no-store');expect(await get.text()).not.toContain('new-private-key');
 expect(JSON.stringify(store.state().adminAudit)).not.toContain('new-private-key');
});
it('generation uses the saved URL and key instead of environment values',async()=>{
 saveImageConfig({baseUrl:'https://new.example/v1',apiKey:'new-private-key',enabled:true});const fetcher=vi.fn(async()=>new Response('',{status:502}));vi.stubGlobal('fetch',fetcher);
 await expect(generateManagedImage({userId:'test',prompt:'synthetic'},new AbortController().signal)).rejects.toMatchObject({code:'IMAGE_UPSTREAM_HTTP_502'});
 const [url,init]=fetcher.mock.calls[0] as unknown as [string,RequestInit];expect(url).toBe('https://new.example/v1/images/generations');expect(init.headers).toMatchObject({Authorization:'Bearer new-private-key'});
 saveImageConfig({baseUrl:'https://new.example/v1',enabled:false});await expect(generateManagedImage({userId:'test',prompt:'synthetic'},new AbortController().signal)).rejects.toMatchObject({code:'IMAGE_NOT_CONFIGURED'});expect(fetcher).toHaveBeenCalledTimes(1);
});

