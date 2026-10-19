// Heartbeats keep both CDN and browser proxies alive while the provider thinks.
// SSE is emitted only at frame boundaries so heartbeats cannot corrupt split JSON.
import { hasCompletionOutput } from '../services/completion-output';
export function phoneChatStream(options:{stream:boolean;signal:AbortSignal;perform:(signal:AbortSignal)=>Promise<Response>;
  finish:(status:string,http:number|null,code:string|null,response:string,truncated:boolean)=>void;timeoutMs?:number;heartbeatMs?:number}) {
  const abort=new AbortController();let cancelled=false,finished=false;
  let heartbeat:ReturnType<typeof setInterval>|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
  let capture='',truncated=false,http:number|null=null;
  const cleanup=()=>{clearInterval(heartbeat);clearTimeout(deadline);options.signal.removeEventListener('abort',cancel);};
  const finish=(status:string,code:string|null)=>{if(finished)return;finished=true;cleanup();try{options.finish(status,http,code,capture,truncated);}catch{console.warn('[phone-chat] failed to finalize call record');}};
  const cancel=()=>{cancelled=true;abort.abort();finish('cancelled','CLIENT_CANCELLED');};
  const encode=new TextEncoder();
  const body=new ReadableStream<Uint8Array>({
    async start(controller) {
      options.signal.addEventListener('abort',cancel,{once:true});
      if(options.signal.aborted){cancel();controller.close();return;}
      const send=(text:string)=>{if(!cancelled)controller.enqueue(encode.encode(text));};
      const pulse=()=>send(options.stream?': keepalive\n\n':' ');
      pulse();heartbeat=setInterval(pulse,options.heartbeatMs??15000);
      deadline=setTimeout(()=>abort.abort(new Error('PHONE_TIMEOUT')),options.timeoutMs??480000);
      let reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
      try {
        const response=await options.perform(abort.signal);http=response.status;
        if(!response.ok){await response.body?.cancel();throw new Error('PHONE_UPSTREAM_FAILED');}
        if(!response.body)throw new Error('PHONE_EMPTY_RESPONSE');
        reader=response.body.getReader();const decoder=new TextDecoder();let buffer='',ended=false,hasOutput=false,carry='';
        const inspectRecord=(data:string)=>{
          if(!data)return;
          if(data==='[DONE]'){if(carry)throw new Error('PHONE_STREAM_INVALID');if(!hasOutput)throw new Error('PHONE_EMPTY_RESPONSE');ended=true;return;}
          let value:unknown;
          try{value=JSON.parse(carry+data);}catch{
            try{value=JSON.parse(data);}catch{carry+=data;if(carry.length>4000000)throw new Error('PHONE_STREAM_INVALID');return;}
          }
          carry='';
          if(value&&typeof value==='object'&&'error' in value)throw new Error('PHONE_UPSTREAM_FAILED');
          hasOutput ||= hasCompletionOutput(value);
        };
        const inspectFrame=(frame:string)=>{
          const records:string[]=[];
          for(const line of frame.split(/\r?\n/)){
            if(line.startsWith('data:'))records.push(line.slice(5).replace(/^ /,''));
            else if(line&&!/^(event:|id:|retry:|:)/.test(line)){
              if(records.length)records[records.length-1]+=line;else records.push(line);
            }
          }
          for(const record of records){inspectRecord(record);if(ended)break;}
        };
        // Buffer non-stream JSON until complete, allowing safe whitespace heartbeats meanwhile.
        while(true){
          const {done,value}=await reader.read();if(done)break;
          const text=decoder.decode(value,{stream:true});
          if(capture.length+text.length>256000)truncated=true;capture=(capture+text).slice(0,256000);
          if(!options.stream){buffer+=text;if(buffer.length>16000000)throw new Error('PHONE_RESPONSE_TOO_LARGE');continue;}
          buffer+=text;
          let match:RegExpExecArray|null;
          while((match=/\r?\n\r?\n/.exec(buffer))){const frame=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);inspectFrame(frame);send(frame+'\n\n');if(ended)break;}
          if(buffer.length>4000000)throw new Error('PHONE_STREAM_INVALID');
          if(ended)break;
        }
        buffer+=decoder.decode();
        if(options.stream){
          if(!ended&&buffer.trim()){inspectFrame(buffer);send(buffer+'\n\n');}
          if(!ended)throw new Error('PHONE_STREAM_INTERRUPTED');
        }else{
          let data:unknown;try{data=JSON.parse(buffer);}catch{throw new Error('PHONE_STREAM_INTERRUPTED');}
          if(data&&typeof data==='object'&&'error' in data)throw new Error('PHONE_UPSTREAM_FAILED');
          if(!hasCompletionOutput(data))throw new Error('PHONE_EMPTY_RESPONSE');
          clearInterval(heartbeat);send(buffer);
        }
        if(!capture.trim())throw new Error('PHONE_EMPTY_RESPONSE');
        finish('complete',null);if(!cancelled)controller.close();
      }catch(e){
        if(cancelled)return;
        const code=abort.signal.aborted?'PHONE_TIMEOUT': e instanceof Error && /^PHONE_/.test(e.message)?e.message:'PHONE_NETWORK_FAILED';
        const error={__yelan_error:true,error:{code,message:code==='PHONE_TIMEOUT'?'回复等待超时，请稍后重试。':'回复未完整收到，请稍后重试。'}};
        send(options.stream?'data: '+JSON.stringify(error)+'\n\ndata: [DONE]\n\n':JSON.stringify(error));
        finish('failed',code);controller.close();
      }finally{await reader?.cancel().catch(()=>{});reader?.releaseLock();cleanup();}
    },cancel,
  });
  return new Response(body,{headers:{'Content-Type':options.stream?'text/event-stream':'application/json','Cache-Control':'private, no-store','X-Accel-Buffering':'no'}});
}
