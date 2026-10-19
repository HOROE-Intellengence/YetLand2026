import { PhoneInspectionArchiveSchema, type PhoneInspectionPreview } from '@yelan/shared';

export async function resolveInspectionArchive(preview:PhoneInspectionPreview,read:(id:string)=>Promise<ArrayBuffer>):Promise<PhoneInspectionPreview>{
  if(!Array.isArray(preview.data.archiveParts))return preview;
  const decoder=new TextDecoder(),texts:string[]=[];let bytes=0;
  for(const ref of preview.data.archiveParts){
    const asset=preview.assets.find(a=>a.ref===ref&&a.state==='stored'&&a.source==='archive');
    if(!asset?.id)throw new Error('完整预览数据缺失');
    const part=await read(asset.id);bytes+=part.byteLength;
    if(bytes>64_000_000)throw new Error('完整预览数据过大');
    texts.push(decoder.decode(part,{stream:true}));
  }
  texts.push(decoder.decode());
  return PhoneInspectionArchiveSchema.parse(JSON.parse(texts.join('')));
}
