import { describe,expect,it,vi } from 'vitest';
import { createInspectionPreview,prepareInspectionPreview } from './phone-inspection-preview';
describe('inspection snapshot media',()=>{
  it('preserves presentation structure while stripping credentials recursively',()=>{
    const preview=createInspectionPreview('custom-app',{entryHtml:'<style>body{color:red}</style><h1>我的页面</h1>',collections:{posts:[{text:'正文',apiKey:'secret',audioDataUrl:'data:audio/ogg;base64,T2dnUw=='}]},password:'private'});
    expect(JSON.stringify(preview)).not.toMatch(/secret|private/);
    expect(preview.data.entryHtml).toContain('<style>');
    expect(JSON.stringify(preview)).toContain('audioDataUrl');
  });
  it('uploads referenced bytes once, replaces them with private refs and marks unavailable assets',async()=>{
    const upload=vi.fn(async()=>{}),url='data:image/png;charset=utf-8;base64,iVBORw0KGgo=';
    const preview=createInspectionPreview('custom-app',{imageData:url,entryHtml:`<img src="${url}">`,coverImage:'https://unavailable.example/image.png'});
    const result=await prepareInspectionPreview(preview,upload);
    expect(upload).toHaveBeenCalledTimes(1);expect(result.assets).toHaveLength(2);expect(result.assets[0]?.mime).toBe('image/png');
    expect(result.assets[0]?.state).toBe('stored');expect(result.assets[1]?.state).toBe('missing');expect(result.partial).toBe(true);
    expect(result.data.imageData).toMatch(/^inspection-asset:\/\//);expect(JSON.stringify(result.data)).not.toContain('iVBOR');
  });
  it('extracts large inline images before applying text limits and blocks remote HTML resources',async()=>{
    const url=`data:image/png;base64,${'A'.repeat(2_000_000)}`,upload=vi.fn(async()=>{});
    const preview=createInspectionPreview('custom-app',{entryHtml:`<h1>用户画面</h1><img src="${url}"><img src="https://external.example/picture.png">`});
    expect(String(preview.data.entryHtml)).toContain(url);
    const result=await prepareInspectionPreview(preview,upload);
    expect(upload).toHaveBeenCalledTimes(1);expect(result.assets.map(asset=>asset.state)).toEqual(['stored','missing']);
    expect(String(result.data.entryHtml)).toContain('用户画面');expect(result.partial).toBe(true);
    expect(JSON.stringify(result)).not.toContain('external.example');
  });
  it('archives large UTF-8 content without dropping paragraphs or marking complete text as partial',async()=>{
    const preview=createInspectionPreview('reading',{chapters:[{title:'长篇',paragraphs:['正文'.repeat(500_000)]}]});
    const files=new Map<string,Blob>();
    const result=await prepareInspectionPreview(preview,async(id,blob)=>{files.set(id,blob);});
    expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThanOrEqual(2_000_000);
    expect(result.partial).toBe(false);expect(result.data.archiveParts).toBeInstanceOf(Array);
    const joined=Buffer.concat(await Promise.all(result.assets.map(async a=>Buffer.from(await files.get(a.id!)!.arrayBuffer())))).toString('utf8');
    expect(JSON.parse(joined).data.chapters[0].paragraphs[0]).toBe('正文'.repeat(500_000));
  });
  it('retains an explicit missing marker for unsupported media without attempting upload',async()=>{
    const upload=vi.fn(async()=>{});
    const result=await prepareInspectionPreview(createInspectionPreview('custom-app',{iconDataUrl:'data:text/html;base64,PHNjcmlwdD48L3NjcmlwdD4='}),upload);
    expect(upload).not.toHaveBeenCalled();expect(result.partial).toBe(true);expect(result.assets[0]).toMatchObject({state:'missing',mime:'text/html'});
  });
});
