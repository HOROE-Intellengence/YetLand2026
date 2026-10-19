import { expect,it } from 'vitest';
import { resolveInspectionArchive } from './inspection-archive';
import type {PhoneInspectionPreview} from '@yelan/shared';

it('reassembles full multilingual documents and resources across UTF-8 part boundaries',async()=>{
  const text='🌙完整内容。'.repeat(160_000),files=new Map<string,ArrayBuffer>();
  const full:PhoneInspectionPreview={version:1,type:'document',data:{title:'长文',body:text},assets:[{id:'f'.repeat(64),ref:'inspection-asset://'+'f'.repeat(64),name:'资源.json',source:'user-upload',mime:'application/json',state:'stored'}],partial:false};
  const bytes=new TextEncoder().encode(JSON.stringify(full)),assets:PhoneInspectionPreview['assets']=[];
  for(let offset=0;offset<bytes.length;offset+=1_000_000){const id=offset.toString(16).padStart(64,'0');files.set(id,bytes.slice(offset,offset+1_000_000).buffer);assets.push({id,ref:`inspection-asset://${id}`,state:'stored',source:'archive',mime:'text/plain'});}
  const header:PhoneInspectionPreview={...full,data:{archiveParts:assets.map(a=>a.ref)},assets};
  expect(header.data.archiveParts).toBeInstanceOf(Array);
  const restored=await resolveInspectionArchive(header,async id=>files.get(id)!);
  expect(restored.data.body).toBe(text);expect(restored.assets[0]).toMatchObject({mime:'application/json',source:'user-upload',name:'资源.json',state:'stored'});
});
