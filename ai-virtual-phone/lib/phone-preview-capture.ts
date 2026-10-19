import { kvGet, kvSet } from './kv-db';
import { isYelanManaged } from './yelan-managed-client';
import { INSPECTION_ASSET_LIMIT, INSPECTION_IMAGE_INPUT_LIMIT, INSPECTION_ASSET_MIME } from '../../packages/shared/src/utils/phone-inspection-assets';

// Capture the app's own rendered document, never the user's desktop or other apps.
export function previewCaptureScript(frameId:string):string {
  return `<script>(function(){
    var timer, last='';
    async function capture(){try{
      var root=document.documentElement.cloneNode(true);
      root.querySelectorAll('script,iframe,object,embed,meta[http-equiv]').forEach(function(n){n.remove()});
      var originals=document.querySelectorAll('canvas');
      root.querySelectorAll('canvas').forEach(function(n,i){try{var img=document.createElement('img');img.src=originals[i].toDataURL('image/png');img.setAttribute('style',n.getAttribute('style')||'');img.width=originals[i].width;img.height=originals[i].height;n.replaceWith(img)}catch(e){n.remove()}});
      var values=document.querySelectorAll('input,textarea,select');root.querySelectorAll('input,textarea,select').forEach(function(n,i){var o=values[i];if(!o)return;if(n.type==='password'){n.value='';n.setAttribute('value','');return}n.setAttribute('value',o.value||'');if(n.tagName==='TEXTAREA')n.textContent=o.value||'';if(n.type==='checkbox'||n.type==='radio')n.toggleAttribute('checked',o.checked);if(n.tagName==='SELECT')Array.from(n.options).forEach(function(option,j){option.toggleAttribute('selected',o.options[j].selected)})});
      root.querySelectorAll('*').forEach(function(n){Array.from(n.attributes).forEach(function(a){if(/^on/i.test(a.name))n.removeAttribute(a.name)})});
      var html='<!doctype html>'+root.outerHTML;
      var at=new Date().toISOString(),media=[],bytes=0;
      var refs=Array.from(new Set(html.match(/(?:blob:|data:)[^\\s"'<>)]*/g)||[])).slice(0,256);
      for(var ref of refs){try{var blob=await(await fetch(ref)).blob();if(blob.size<=(blob.type.indexOf('image/')===0?${INSPECTION_IMAGE_INPUT_LIMIT}:${INSPECTION_ASSET_LIMIT})&&bytes+blob.size<=${INSPECTION_IMAGE_INPUT_LIMIT}){var retainedRef=ref;if(ref.indexOf('data:')===0){var digest=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());retainedRef='blob:inspection/'+Array.from(new Uint8Array(digest)).map(function(b){return b.toString(16).padStart(2,'0')}).join('');html=html.split(ref).join(retainedRef)}media.push({ref:retainedRef,blob:blob});bytes+=blob.size}}catch(e){}}
      if(html.length>1000000||html===last)return;last=html;
      parent.postMessage({type:'yelan.inspection.scene',frameId:${JSON.stringify(frameId)},html:html,at:at,media:media},'*');
    }catch(e){}}
    function schedule(){clearTimeout(timer);timer=setTimeout(capture,1500)}
    new MutationObserver(schedule).observe(document.documentElement,{childList:true,subtree:true,attributes:true});
    document.addEventListener('click',schedule);document.addEventListener('change',schedule);setTimeout(capture,2000);
  })();</script>`;
}
const sceneMedia = new Map<string,Promise<string>>();
export async function retainPreviewScene(id:string,html:unknown,media?:unknown,at?:unknown){
  if(!isYelanManaged||typeof html!=='string'||html.length>1000000)return;
  try {
  let retainedHtml=html;
  let bytes=0;
  for(const value of Array.isArray(media)?media.slice(0,256):[]){
    if(!value||typeof value!=='object')continue;
    const {ref,blob}=value as {ref?:unknown;blob?:unknown};
    if(typeof ref!=='string'||!ref.startsWith('blob:')||ref.length>500||!retainedHtml.includes(ref)||!(blob instanceof Blob)||blob.size>(blob.type.startsWith('image/')?INSPECTION_IMAGE_INPUT_LIMIT:INSPECTION_ASSET_LIMIT)||bytes+blob.size>INSPECTION_IMAGE_INPUT_LIMIT)continue;
    const mime=blob.type.split(';')[0]?.trim().toLowerCase()||'';
    if(!INSPECTION_ASSET_MIME.test(mime))continue;
    bytes+=blob.size;
    const key=`${id}/${ref}`;
    if(!sceneMedia.has(key)){
      if(sceneMedia.size>=128)sceneMedia.delete(sceneMedia.keys().next().value!);
      const category=mime.startsWith('image/')?'image':mime.startsWith('audio/')?'audio':mime.startsWith('video/')?'video':'file';
      sceneMedia.set(key,import('./media-cache-storage').then(store=>store.storeMediaBlob(blob.slice(0,blob.size,mime),mime,category)).catch(()=>{sceneMedia.delete(key);return ref;}));
    }
    retainedHtml=retainedHtml.split(ref).join(await sceneMedia.get(key)!);
  }
  let scenes:Record<string,{html:string;at:string}[]>={};try{scenes=JSON.parse(kvGet('yelan-inspection-scenes-v1')||'{}');}catch{/*Fresh capture store.*/}
  const rows=scenes[id]||[];
  if(rows.at(-1)?.html===retainedHtml)return;
  rows.push({html:retainedHtml,at:typeof at==='string'&&Number.isFinite(Date.parse(at))?new Date(at).toISOString():new Date().toISOString()});
  rows.sort((a,b)=>a.at.localeCompare(b.at));
  while(rows.length>4||rows.reduce((n,r)=>n+r.html.length,0)>1800000)rows.shift();
  scenes[id]=rows;kvSet('yelan-inspection-scenes-v1',JSON.stringify(scenes));
  window.dispatchEvent(new CustomEvent('yelan-inspection-changed'));
  } catch { /* Preview retention must not interrupt the running app. */ }
}
