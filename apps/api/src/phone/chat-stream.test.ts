import {afterEach,it,expect,vi} from 'vitest';
import {phoneChatStream} from './chat-stream';
afterEach(()=>vi.useRealTimers());
it('keeps waiting past the old 180s deadline and completes without retry',async()=>{
 vi.useFakeTimers();let resolve!:(r:Response)=>void;const perform=vi.fn(()=>new Promise<Response>(r=>resolve=r)),finish=vi.fn();
 const r=phoneChatStream({stream:true,signal:new AbortController().signal,perform,finish});const result=r.text();
 await vi.advanceTimersByTimeAsync(190000);expect(finish).not.toHaveBeenCalled();resolve(new Response('data: {"choices":[{"delta":{"content":"完整回复"}}]}\n\ndata: [DONE]\n\n'));
 const body=await result;expect(body.match(/keepalive/g)!.length).toBeGreaterThan(10);expect(body).toContain('完整回复');expect(perform).toHaveBeenCalledTimes(1);expect(finish.mock.calls[0]![0]).toBe('complete');expect(vi.getTimerCount()).toBe(0);
});
it('never inserts heartbeat bytes inside a split SSE JSON record',async()=>{
 vi.useFakeTimers();let upstream!:ReadableStreamDefaultController<Uint8Array>;const encode=new TextEncoder();
 const response=new Response(new ReadableStream({start(c){upstream=c}}));const finish=vi.fn();const r=phoneChatStream({stream:true,signal:new AbortController().signal,perform:async()=>response,finish});const text=r.text();
 upstream.enqueue(encode.encode('data: {"choices":[{"delta":{"content":"你好'));await vi.advanceTimersByTimeAsync(20000);upstream.enqueue(encode.encode('世界"}}]}\n\ndata: [DONE]\n\n'));upstream.close();
 expect(await text).toContain('data: {"choices":[{"delta":{"content":"你好世界"}}]}\n\n');
});
it('reports a dropped stream as failure instead of successful partial output',async()=>{
 const finish=vi.fn();const r=phoneChatStream({stream:true,signal:new AbortController().signal,perform:async()=>new Response('data: {"choices":[{"delta":{"content":"half"}}]}\n\n'),finish});
 expect(await r.text()).toContain('PHONE_STREAM_INTERRUPTED');expect(finish.mock.calls[0]![0]).toBe('failed');
});
it('returns a recognizable JSON error and records upstream status',async()=>{
 const finish=vi.fn();const r=phoneChatStream({stream:false,signal:new AbortController().signal,perform:async()=>new Response('secret provider details',{status:429}),finish});
 expect(await r.json()).toMatchObject({__yelan_error:true,error:{code:'PHONE_UPSTREAM_FAILED'}});expect(finish.mock.calls[0]![1]).toBe(429);
});
it('aborts provider work when the user cancels',async()=>{
 const finish=vi.fn();let signal!:AbortSignal;const r=phoneChatStream({stream:true,signal:new AbortController().signal,perform:s=>{signal=s;return new Promise(()=>{})},finish});await r.body!.cancel();expect(signal.aborted).toBe(true);expect(finish.mock.calls[0]![0]).toBe('cancelled');
});
it('keeps JSON heartbeats running after headers without corrupting partial strings',async()=>{
 vi.useFakeTimers();let source!:ReadableStreamDefaultController<Uint8Array>;const encoder=new TextEncoder();
 const r=phoneChatStream({stream:false,signal:new AbortController().signal,finish:vi.fn(),perform:async()=>new Response(new ReadableStream({start(c){source=c}}))});const data=r.json();
 source.enqueue(encoder.encode('{"choices":[{"message":{"content":"前'));await vi.advanceTimersByTimeAsync(190000);source.enqueue(encoder.encode('后"}}]}'));source.close();expect(await data).toEqual({choices:[{message:{content:'前后'}}]});
});
it('reports the configured deadline as timeout and cleans timers',async()=>{
 vi.useFakeTimers();const finish=vi.fn();const r=phoneChatStream({stream:true,signal:new AbortController().signal,timeoutMs:1000,finish,perform:signal=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted'))))});
 const text=r.text();await vi.advanceTimersByTimeAsync(1001);expect(await text).toContain('PHONE_TIMEOUT');expect(finish.mock.calls[0]![2]).toBe('PHONE_TIMEOUT');expect(vi.getTimerCount()).toBe(0);
});
it.each([false,true])('rejects empty successful responses (stream=%s) without retry',async stream=>{
 const perform=vi.fn(async()=>stream?new Response('data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: [DONE]\n\n'):
 Response.json({choices:[{message:{content:null,reasoning_content:'only thinking'}}]}));
 const finish=vi.fn(),r=phoneChatStream({stream,signal:new AbortController().signal,perform,finish});
 expect(await r.text()).toContain('PHONE_EMPTY_RESPONSE');expect(finish.mock.calls[0]![0]).toBe('failed');expect(perform).toHaveBeenCalledTimes(1);
});
it('rejects an upstream error embedded in HTTP 200 SSE',async()=>{
 const finish=vi.fn(),r=phoneChatStream({stream:true,signal:new AbortController().signal,finish,
 perform:async()=>new Response('data: {"error":{"code":"provider_error","message":"private details"}}\n\ndata: [DONE]\n\n')});
 const wire=await r.text();expect(wire).toContain('PHONE_UPSTREAM_FAILED');expect(wire).not.toContain('private details');expect(finish.mock.calls[0]![0]).toBe('failed');
});
it('keeps tool-only turns valid and tolerates provider JSON split between events',async()=>{
 const finish=vi.fn(),r=phoneChatStream({stream:true,signal:new AbortController().signal,finish,
 perform:async()=>new Response('data: {"choices":[{"delta":{"tool_calls":[{"id":"call-1","function":{"name":"ping","arguments":"{\\"x\\":\n\ndata: 1}"}}]}}]}\n\ndata: [DONE]\n\n')});
 const wire=await r.text();expect(wire).not.toContain('__yelan_error');expect(finish.mock.calls[0]![0]).toBe('complete');
});

