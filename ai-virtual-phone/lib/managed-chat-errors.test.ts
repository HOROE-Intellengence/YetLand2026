import {it,expect,vi} from 'vitest';
import {createSseJsonParser} from './sse-json';
import {getApiLogs,pushApiLog} from './api-log-store';
import {kvSet,kvRemove} from './kv-db';
vi.mock('./yelan-managed-client',()=>({isYelanManaged:true}));
vi.mock('./kv-db',()=>({kvGet:vi.fn(),kvSet:vi.fn(),kvRemove:vi.fn(),registerKvMigration:vi.fn()}));
it('ignores keepalive comments but surfaces a managed stream failure',()=>{
 const parser=createSseJsonParser();expect(parser.pushEvent(': keepalive')).toEqual([]);
 expect(()=>parser.pushEvent('data: '+JSON.stringify({__yelan_error:true,error:{message:'回复未完整收到，请稍后重试。'}}))).toThrow('回复未完整收到');
});
it('surfaces standard upstream SSE errors instead of swallowing them as empty deltas',()=>{
 const parser=createSseJsonParser();
 expect(()=>parser.pushEvent('data: '+JSON.stringify({error:{code:'UPSTREAM_EMPTY_RESPONSE',message:'上游没有回复'}}))).toThrow('上游没有回复');
});
it('checks errors reconstructed across split SSE events',()=>{
 const parser=createSseJsonParser();expect(parser.pushEvent('data: {"error":{"message":"回复')).toEqual([]);
 expect(()=>parser.pushEvent('data: 失败"}}')).toThrow('回复失败');
});
it('does not retain or expose local provider logs in managed mode',()=>{
 pushApiLog({} as Parameters<typeof pushApiLog>[0]);expect(getApiLogs()).toEqual([]);expect(kvSet).not.toHaveBeenCalled();expect(kvRemove).toHaveBeenCalled();
});
