import {it,expect,vi,afterEach} from 'vitest';
import {adminPhoneChatLogsRoute} from './phone-chat-logs';
vi.mock('../../phone/chat-logs',()=>({phoneChatLogs:()=>({list:()=>({items:[],total:0}),get:()=>undefined})}));
afterEach(()=>vi.unstubAllEnvs());
it('restricts list and detail to administrators and rejects invalid pages',async()=>{
 vi.stubEnv('ADMIN_TOKEN','logs-test-admin');
 for(const path of ['/','/call-id'])for(const token of ['', 'Bearer ordinary'])expect((await adminPhoneChatLogsRoute.request(path,{headers:{Authorization:token}})).status).toBe(401);
 const headers={Authorization:'Bearer logs-test-admin'};const r=await adminPhoneChatLogsRoute.request('/',{headers});expect(r.status).toBe(200);expect(r.headers.get('cache-control')).toBe('private, no-store');
 expect((await adminPhoneChatLogsRoute.request('/?page=-1',{headers})).status).toBe(400);
});
