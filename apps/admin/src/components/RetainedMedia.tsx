import { useEffect, useRef, useState } from 'react';
import { getAuthHeaders, getBase } from '../api/client';

// Binary reads always use the administrator header. Temporary object URLs never
// expose a token or signed credential in links or embedded documents.
export function RetainedMedia({path,mime,label,thumbnail}:{path:string;mime:string;label:string;thumbnail?:string|null}) {
  const [url,setUrl]=useState(''),[open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(''),[actual,setActual]=useState(false),[imageError,setImageError]=useState(false);
  const contentMime=useRef(mime),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
  useEffect(()=>{if(!open)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[open]);
  async function load(){
    if(url)return url;setBusy(true);setError('');
    try{const response=await fetch(getBase()+path,{headers:getAuthHeaders()});if(!response.ok)throw new Error();const blob=await response.blob();if(!active.current)return '';contentMime.current=blob.type||mime;const next=URL.createObjectURL(blob);setUrl(next);return next;}
    catch{setError('资源读取失败，请重试。');return '';}
    finally{setBusy(false);}
  }
  async function download(){const next=await load();if(!next)return;const anchor=document.createElement('a');anchor.href=next;const savedMime=contentMime.current,extension=({'image/png':'png','image/jpeg':'jpg','image/webp':'webp','image/gif':'gif','image/svg+xml':'svg','application/json':'json','application/pdf':'pdf','application/zip':'zip','audio/ogg':'ogg','audio/mpeg':'mp3','audio/wav':'wav','video/mp4':'mp4','video/webm':'webm','text/plain':'txt','text/css':'css'} as Record<string,string>)[savedMime];anchor.download=extension?(savedMime.startsWith('image/')?label.replace(/\.(png|jpe?g|webp|gif|svg)$/i,''):`${label}`.replace(new RegExp(`\\.${extension}$`,'i'),''))+'.'+extension:label;anchor.click();}
  return <div className="retained-media">
    {thumbnail&&<button type="button" className="inspection-image-button" aria-label={`查看 ${label}`} onClick={()=>void load().then(next=>{if(next)setOpen(true);})}><img src={thumbnail} alt={label} loading="lazy"/></button>}
    <div className="inspection-scene-tabs"><button type="button" className="btn btn-sm" disabled={busy} onClick={()=>void load().then(next=>{if(next)setOpen(true);})}>{busy?'读取中…':mime.startsWith('image/')?'查看完整图片':mime.startsWith('audio/')||mime.startsWith('video/')?'播放资源':'查看资源'}</button><button type="button" className="btn btn-sm" disabled={busy} onClick={()=>void download()}>下载</button></div>
    {error&&<p role="alert">{error}</p>}
    {open&&url&&<div className="inspection-media-dialog" role="dialog" aria-modal="true" aria-label={label}>
      <div className="inspection-media-controls"><strong>{label}</strong>{mime.startsWith('image/')&&<button type="button" className="btn" onClick={()=>setActual(v=>!v)}>{actual?'适应窗口':'100% 查看'}</button>}<button type="button" className="btn" onClick={()=>void download()}>下载</button><button type="button" className="btn" autoFocus onClick={()=>setOpen(false)}>关闭</button></div>
      <div className={`inspection-media-stage${actual?' actual-size':''}`}>
        {mime.startsWith('image/')?imageError?<p>此文件无法在浏览器中显示，原文件仍可下载。</p>:<img src={url} alt={label} onError={()=>setImageError(true)}/>:mime.startsWith('audio/')?<audio src={url} controls/>:mime.startsWith('video/')?<video src={url} controls/>:/^(text\/(plain|css|csv|markdown)|application\/json)$/.test(mime)?<TextResource url={url}/>:<p>此资源已完整留存，请下载后用对应软件打开。</p>}
      </div>
    </div>}
  </div>;
}
function TextResource({url}:{url:string}){
  const [text,setText]=useState(''),[page,setPage]=useState(0);
  useEffect(()=>{let active=true;setPage(0);void fetch(url).then(r=>r.text()).then(t=>{if(active)setText(t);});return()=>{active=false;};},[url]);
  const count=Math.max(1,Math.ceil(text.length/12000));
  return <div><pre className="inspection-resource-text">{text.slice(page*12000,(page+1)*12000)}</pre>{count>1&&<div className="inspection-scene-tabs"><button className="btn" disabled={!page} onClick={()=>setPage(p=>p-1)}>上一页内容</button><span>第 {page+1}/{count} 页 · 完整留存 {text.length} 字符</span><button className="btn" disabled={page===count-1} onClick={()=>setPage(p=>p+1)}>下一页内容</button></div>}</div>;
}
