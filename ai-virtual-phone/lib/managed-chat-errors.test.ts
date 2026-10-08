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
it('does not retain or expose local provider logs in managed mode',()=>{
 pushApiLog({} as Parameters<typeof pushApiLog>[0]);expect(getApiLogs()).toEqual([]);expect(kvSet).not.toHaveBeenCalled();expect(kvRemove).toHaveBeenCalled();
});
