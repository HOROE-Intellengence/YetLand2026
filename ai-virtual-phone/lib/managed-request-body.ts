export async function boundedRequestBody(request:Request,limit:number):Promise<ArrayBuffer|undefined>{
  if(request.method==='GET'||request.method==='HEAD')return undefined;
  const declared=request.headers.get('content-length');
  if(Number(declared)>limit)throw new Error('BODY_TOO_LARGE');
  const reader=request.body?.getReader();if(!reader){if(Number(declared)>0)throw new Error('BODY_INCOMPLETE');return new ArrayBuffer(0);}
  const chunks:Uint8Array[]=[];let size=0;
  try{
    while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>limit){await reader.cancel();throw new Error('BODY_TOO_LARGE');}chunks.push(next.value);}
  }finally{reader.releaseLock();}
  if(declared!==null&&Number.isSafeInteger(Number(declared))&&Number(declared)!==size)throw new Error('BODY_INCOMPLETE');
  const body=new Uint8Array(size);let offset=0;for(const part of chunks){body.set(part,offset);offset+=part.length;}return body.buffer;
}
