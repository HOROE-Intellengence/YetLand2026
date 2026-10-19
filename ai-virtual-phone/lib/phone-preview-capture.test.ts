import { beforeEach, describe, expect, it, vi } from 'vitest';
const storage=vi.hoisted(()=>({kv:new Map<string,string>(),blobs:new Map<string,Blob>()}));
vi.mock('./kv-db',()=>({kvGet:(key:string)=>storage.kv.get(key),kvSet:(key:string,value:string)=>storage.kv.set(key,value)}));
vi.mock('./yelan-managed-client',()=>({isYelanManaged:true}));
vi.mock('./media-cache-storage',()=>({
  storeMediaBlob:vi.fn(async(blob:Blob)=>{const ref=`media-store://qa-${storage.blobs.size}`;storage.blobs.set(ref,blob);return ref;}),
  loadMediaBlob:async(ref:string)=>({blob:storage.blobs.get(ref)??null}),
}));
import { retainPreviewScene } from './phone-preview-capture';
import { createInspectionPreview, prepareInspectionPreview } from './phone-inspection-preview';

describe('sandboxed app media retention',()=>{
  beforeEach(()=>{storage.kv.clear();storage.blobs.clear();vi.stubGlobal('window',{dispatchEvent:vi.fn()});});
  it('retains child-owned blob bytes so preview preparation never fetches the inaccessible child URL',async()=>{
    const ref='blob:null/child-image-qa',bytes=new Uint8Array([137,80,78,71]);
    const media=[{ref,blob:new Blob([bytes],{type:'image/png;charset=utf-8'})}];
    await retainPreviewScene('app-qa',`<img src="${ref}">`,media,'2026-10-13T00:02:00Z');
    await retainPreviewScene('app-qa',`<h1>另一画面</h1><img src="${ref}">`,media,'2026-10-13T00:01:00Z');
    expect(storage.blobs.size).toBe(1);
    const scenes=JSON.parse(storage.kv.get('yelan-inspection-scenes-v1')!)['app-qa'];
    expect(scenes[0].at).toBe('2026-10-13T00:01:00.000Z');
    const upload=vi.fn(async(_id:string,blob:Blob)=>{expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes);});
    const preview=await prepareInspectionPreview(createInspectionPreview('custom-app',{scenes}),upload);
    expect(upload).toHaveBeenCalledTimes(1);expect(preview.partial).toBe(false);
    expect(JSON.stringify(preview)).not.toContain('blob:null');expect(preview.assets[0]?.state).toBe('stored');
  });
  it('ignores unrelated or unsupported files in frame messages',async()=>{
    await retainPreviewScene('app-rejected','<h1>只留当前页面</h1>',[{ref:'https://external.example/image.png',blob:new Blob(['image'],{type:'image/png'})},{ref:'blob:null/unreferenced',blob:new Blob(['script'],{type:'text/html'})}]);
    expect(storage.blobs.size).toBe(0);expect(storage.kv.get('yelan-inspection-scenes-v1')).toContain('只留当前页面');
  });
});
