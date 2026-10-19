import {expect,it} from 'vitest';
import {boundedRequestBody} from './managed-request-body';
it('rejects declared and streamed over-limit bodies before forwarding',async()=>{
  await expect(boundedRequestBody(new Request('http://localhost',{method:'POST',headers:{'Content-Length':'100'},body:'abc'}),10)).rejects.toThrow('BODY_TOO_LARGE');
  const request=new Request('http://localhost',{method:'POST',body:'12345678901'});await expect(boundedRequestBody(request,10)).rejects.toThrow('BODY_TOO_LARGE');
});
it('preserves binary uploads and leaves GET bodies absent',async()=>{
  const bytes=new Uint8Array([0,255,1,128]);expect(new Uint8Array((await boundedRequestBody(new Request('http://localhost',{method:'POST',body:bytes}),4))!)).toEqual(bytes);
  expect(await boundedRequestBody(new Request('http://localhost'),4)).toBeUndefined();
});
it('rejects silently truncated bodies instead of forwarding a successful partial file',async()=>{
  await expect(boundedRequestBody(new Request('http://localhost',{method:'POST',headers:{'Content-Length':'12'},body:'abc'}),20)).rejects.toThrow('BODY_INCOMPLETE');
  await expect(boundedRequestBody(new Request('http://localhost',{method:'POST',headers:{'Content-Length':'12'}}),20)).rejects.toThrow('BODY_INCOMPLETE');
});
