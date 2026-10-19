import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { Pagination } from '../components/Pagination';
import { RetainedMedia } from '../components/RetainedMedia';
import '../components/InspectionPreview.css';

interface Material { id:string;userId:string;characterId:string|null;prompt:string;model:string;createdAt:string;bytes:number;originalBytes:number;mime:string;source:string;fileName:string;originalAvailable:boolean;thumbnailDataUrl:string|null;links:{recordKey:string;title:string}[] }
interface Page {items:Material[];total:number;page:number;pageSize:number}
const sources:Record<string,string>={generated:'平台生成','user-upload':'用户上传','phone-inspection':'小手机资源'};
export function Materials(){
  const [page,setPage]=useState(1),[data,setData]=useState<Page|null>(null),[filter,setFilter]=useState(''),[userId,setUserId]=useState(''),[source,setSource]=useState(''),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useEffect(()=>{let active=true;setError('');setData(null);void api.get<Page>(`/api/admin/materials?${new URLSearchParams({page:String(page),userId,source})}`).then(value=>{if(active)setData(value);}).catch(()=>{if(active)setError('素材加载失败，请检查后台连接与权限。');});return()=>{active=false;};},[page,userId,source,revision]);
  return <section><h1>素材库</h1><p>留存用户上传、平台生成及小手机关联资源。图片超过 2 MB 时压缩保存；音视频和其他资源保留原文件。</p>
    <form onSubmit={event=>{event.preventDefault();setPage(1);setUserId(filter.trim());}} className="inspection-scene-tabs"><input aria-label="按用户 ID 筛选" placeholder="用户 ID，留空显示全部" value={filter} onChange={e=>setFilter(e.target.value)}/><select aria-label="素材来源" value={source} onChange={e=>{setPage(1);setSource(e.target.value);}}><option value="">全部来源</option>{Object.entries(sources).map(([id,name])=><option value={id} key={id}>{name}</option>)}</select><button className="btn">筛选</button><button className="btn" type="button" onClick={()=>setRevision(v=>v+1)}>刷新</button></form>
    {error&&<p role="alert">{error}</p>}{!data&&!error&&<p>加载中…</p>}
    {data&&<><p>共 {data.total} 项</p>{!data.items.length&&<p>暂无素材</p>}<div className="inspection-material-grid">{data.items.map(item=><article className="inspection-material-card" key={item.id}>
      <RetainedMedia path={`/api/admin/materials/${encodeURIComponent(item.id)}/content`} mime={item.mime} label={item.fileName||item.prompt.slice(0,80)||`资源 ${item.id}`} thumbnail={item.thumbnailDataUrl}/>
      <p>{item.prompt||item.fileName||item.mime}</p><small>{sources[item.source]||item.source} · {Math.round(item.bytes/1024)} KB{item.originalBytes>item.bytes?`（压缩前 ${Math.round(item.originalBytes/1024)} KB）`:''}<br/>用户：{item.userId}<br/>{item.characterId&&<>角色：{item.characterId}<br/></>}{new Date(item.createdAt).toLocaleString()}</small>
      {!item.originalAvailable&&<p className="inspection-missing">历史记录仅有缩略图，原文件尚未补传。</p>}
      {item.links?.map(link=><p key={link.recordKey}><a href={`#phone-inspections?record=${encodeURIComponent(link.recordKey)}`}>{link.title}</a></p>)}
    </article>)}</div><Pagination page={page} total={data.total} pageSize={data.pageSize} onChange={setPage}/></>}
  </section>;
}
