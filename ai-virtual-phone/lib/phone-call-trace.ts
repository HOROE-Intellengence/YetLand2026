import { isYelanManaged } from './yelan-managed-client';
import type { LlmRequestPayload } from './llm-provider-adapter';
export function tracePhoneCall(request:LlmRequestPayload,options?:{appId?:string;debugSessionId?:string}){
  if(!isYelanManaged||!request.url.startsWith('/api/host/phone/')||!options?.appId)return request;
  let existing:Record<string,unknown>={};try{existing=JSON.parse(decodeURIComponent(request.headers['X-Yelan-Call-Trace']||''));}catch{/*No existing scope.*/}
  request.headers['X-Yelan-Call-Trace']=encodeURIComponent(JSON.stringify({...existing,sourceApp:existing.sourceApp||options.appId.slice(0,100),sessionId:existing.sessionId||options.debugSessionId?.slice(0,200),operation:'generate'}));
  return request;
}
