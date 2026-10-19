import type { PhoneInspectionRecord } from '../../packages/shared/src/contracts/phone';
import type { PhoneInspectionPreview } from '../../packages/shared/src/contracts/phone-inspection-preview';
import { INSPECTION_ASSET_LIMIT,INSPECTION_IMAGE_INPUT_LIMIT,INSPECTION_ASSET_MIME } from '../../packages/shared/src/utils/phone-inspection-assets';

const credentials = /^(apiKey|apiConfig|authorization|accessToken|refreshToken|token|password|passwordHash|cookie|clientSecret|secretKey|signingKey|credentials|backendLogs|toolDebugs|nativeToolResult|nativeToolReasoning|rawOutputs)$/i;
const localMediaRefs = /(?:data:[^\s"'<>)]{20,}|media-store:\/\/[^\s"'<>)]*|blob:[^\s"'<>)]*)/g;
const encoder = new TextEncoder();
export function createInspectionPreview(kind: PhoneInspectionRecord['kind'], input: Record<string, unknown>): PhoneInspectionPreview {
  let partial = false;
  function clean(value: unknown, depth=0): unknown {
    if (depth>64) {partial=true; return null;}
    if (typeof value==='string') {
      if(value.startsWith('data:') || value.startsWith('media-store://') || value.startsWith('blob:')) return value;
      // Keep embedded binary references intact until they have been uploaded.
      const refs:string[]=[];
      const protectedText=value.replace(localMediaRefs,ref=>`__YELAN_MEDIA_${refs.push(ref)-1}__`);
      const text=protectedText.replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g,'[密钥已隐藏]').replace(/Bearer\s+[A-Za-z0-9._-]{20,}/gi,'Bearer [已隐藏]');
      return text.replace(/__YELAN_MEDIA_(\d+)__/g,(_,index)=>refs[Number(index)]||'');
    }
    if(Array.isArray(value))return value.map(v=>clean(v,depth+1));
    if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!credentials.test(key)).map(([key,v])=>[key,clean(v,depth+1)]));
    return value;
  }
  const type = kind==='custom-app'?'app':kind==='game'?'game':kind==='vn'?'vn':kind==='interview'||kind==='chat'?'conversation':kind==='note'?(input.catalog?'shopping':'feed'):kind==='role'||kind==='worldview'?'profile':'document';
  const ordered=Object.fromEntries([...new Set(['scenes','messages','transcript','chapters','title','name',...Object.keys(input)])].filter(k=>input[k]!==undefined).map(k=>[k,input[k]]));
  const data=clean(ordered) as Record<string,unknown>;
  return {version:1,type,data,assets:[],partial};
}

// Read only referenced files; public images are delegated to the guarded API.
export type InspectionAssetInfo = {name?:string;source?:'user-upload'|'phone-inspection'|'archive'};
export async function prepareInspectionPreview(preview: PhoneInspectionPreview, upload: (id:string,blob:Blob,info?:InspectionAssetInfo)=>Promise<void>, remoteImage?: (url:string)=>Promise<{id:string;mime:string}>): Promise<PhoneInspectionPreview> {
  const result: PhoneInspectionPreview = {...preview,data:{},assets:[],partial:preview.partial};
  const seen = new Map<string,string>();
  async function media(ref:string, theme=false, info:InspectionAssetInfo={}):Promise<string> {
    if(seen.has(ref))return seen.get(ref)!;
    if(result.assets.length>=10000)throw new Error('INSPECTION_TOO_MANY_ASSETS');
    if(/^https:\/\//.test(ref)&&remoteImage){
      try{const saved=await remoteImage(ref),storedRef=`inspection-asset://${saved.id}`;result.assets.push({ref:storedRef,id:saved.id,mime:saved.mime,state:'stored',...info});seen.set(ref,storedRef);return storedRef;}catch{/* Unavailable remote images stay explicitly missing. */}
    }
    let blob:Blob|null=null;
    try {
      if(ref.startsWith('data:')||ref.startsWith('blob:')) blob=await (await fetch(ref)).blob();
      else if(ref.startsWith('media-store://')) blob=(await (await import('./media-cache-storage')).loadMediaBlob(ref))?.blob??null;
      else if(theme) {const url=await (await import('./theme-storage')).getThemeAssetDataUrl(ref); if(url)blob=await(await fetch(url)).blob();}
    }catch{ /* Missing device-local media remain explicitly incomplete. */ }
    if(blob){const mime=blob.type.split(';')[0]?.trim().toLowerCase()||'';if(mime!==blob.type)blob=blob.slice(0,blob.size,mime);}
    const token=`inspection-asset://missing-${result.assets.length}`;
    const inputLimit=blob?.type.startsWith('image/')?INSPECTION_IMAGE_INPUT_LIMIT:INSPECTION_ASSET_LIMIT;
    if(!blob || blob.size>inputLimit || !INSPECTION_ASSET_MIME.test(blob.type)){result.assets.push({ref:token,state:blob&&blob.size>inputLimit?'too-large':'missing',...(blob?{mime:blob.type.slice(0,100)}:{})});result.partial=true;seen.set(ref,token);return token;}
    const bytes=await blob.arrayBuffer();
    const id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
    const storedRef=`inspection-asset://${id}`;
    if(result.assets.some(asset=>asset.ref===storedRef&&asset.state==='stored')){seen.set(ref,storedRef);return storedRef;}
    try{await upload(id,blob,info);result.assets.push({ref:storedRef,id,mime:blob.type,state:'stored',...info});seen.set(ref,storedRef);return storedRef;}
    catch{result.assets.push({ref:storedRef,mime:blob.type,state:'missing'});result.partial=true;seen.set(ref,storedRef);return storedRef;}
  }
  async function visit(value:unknown,key='',info:InspectionAssetInfo={}):Promise<unknown> {
    if(typeof value==='string'){
      if(value.startsWith('data:')&&!/[\n<>]/.test(value))return media(value,false,info);
      if(value.startsWith('media-store://')||value.startsWith('blob:'))return media(value,false,info);
      if(/assetIds?$/i.test(key)&&value)return media(value,true,info);
      if(/^https?:\/\//.test(value)&&/image|photo|cover|poster|avatar|src|icon|mediaUrl/i.test(key))return media(value,false,info);
      // Preserve inline layout and replace referenced binary assets independently.
      let text=value;
      const refs=[...new Set(text.match(localMediaRefs)??[])];
      // External HTML/CSS resources are unavailable in the isolated preview.
      if(/<[a-z]/i.test(text)||/url\(/i.test(text))refs.push(...[...text.matchAll(/(?:\b(?:src|poster|href)\s*=\s*["']|url\(\s*["']?)(https?:\/\/[^\s"'<>)]*)/gi)].map(match=>match[1]!));
      for(const ref of refs)text=text.split(ref).join(await media(ref,false,info));
      return text;
    }
    if(Array.isArray(value)){const out=[];for(const item of value)out.push(await visit(item,key,info));return out;}
    if(value&&typeof value==='object'){const row=value as Record<string,unknown>,out:Record<string,unknown>={};const meta=row.mediaData&&typeof row.mediaData==='object'?row.mediaData as Record<string,unknown>:{};const next={...info,...(row.role==='user'?{source:'user-upload' as const}:{}),...(typeof meta.fileName==='string'?{name:meta.fileName.slice(0,240)}:{})};for(const [k,v]of Object.entries(value))out[k]=await visit(v,k,next);return out;}
    return value;
  }
  result.data=await visit(preview.data) as Record<string,unknown>;
  return archiveFullPreview(result,upload);
}

// Use a byte budget after replacing media, so Chinese text and JSON escaping do
// not exceed the 4 MiB record endpoint together with the original sections.
async function archiveFullPreview(preview:PhoneInspectionPreview,upload:(id:string,blob:Blob,info?:InspectionAssetInfo)=>Promise<void>):Promise<PhoneInspectionPreview>{
  const json=JSON.stringify(preview),bytes=encoder.encode(json);
  if(bytes.length<=1_800_000 && preview.assets.length<=120)return preview;
  if(bytes.length>64_000_000)throw new Error('INSPECTION_ARCHIVE_TOO_LARGE');
  const assets:PhoneInspectionPreview['assets']=[],archiveParts:string[]=[];
  // Slice bytes, rather than JS strings, so surrogate pairs survive the round trip.
  for(let offset=0;offset<bytes.length;offset+=1_000_000){
    const part=bytes.slice(offset,offset+1_000_000),id=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',part))).map(b=>b.toString(16).padStart(2,'0')).join(''),ref=`inspection-asset://${id}`;
    await upload(id,new Blob([part],{type:'text/plain'}),{source:'archive',name:'完整预览数据'});
    assets.push({ref,id,mime:'text/plain',state:'stored',source:'archive'});archiveParts.push(ref);
  }
  return {...preview,data:{archiveParts,resourceCount:preview.assets.length},assets};
}
