import { useEffect, useRef, useState } from 'react';
import { latestUserInput, semanticPhoneBlocks, type PhoneChatLogDetail } from '@yelan/shared';
import { api } from '../api/client';
import { RecordReader } from './RecordReader';
import { Pagination } from './Pagination';
import { inspectionHtml } from '../lib/inspection-html';
import { useFullscreen } from '../lib/use-fullscreen';
type Thread={items:PhoneChatLogDetail[];total:number;pageSize:number;grouping:'session'|'historical'};
export function PhoneResponse({value}:{value:unknown}){
  return <>{semanticPhoneBlocks(value).map((b,i)=>/<(?:div|p|span|table|style|br)[\s/>]/i.test(b.text)?<iframe key={i} title="角色排版回复" sandbox="" className="inspection-rich-frame" srcDoc={inspectionHtml(b.text)}/>:<RecordReader key={i} value={b.text} label={b.label}/>)}</>;
}
export function PhoneThreadReader({id}:{id:string}){
  const [data,setData]=useState<Thread|null>(null),[page,setPage]=useState(1),[loading,setLoading]=useState(false),[error,setError]=useState('');
  const [font,setFont]=useState(()=>Number(localStorage.getItem('phone-reader-font'))||16),[light,setLight]=useState(()=>localStorage.getItem('phone-reader-light')==='true');
  const {ref:root,fullscreen,toggle}=useFullscreen(),prose=useRef<HTMLDivElement>(null);
  useEffect(()=>{setPage(1);setData(null);},[id]);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');setData(null);
    void api.get<Thread>(`/api/admin/phone-chat-logs/${encodeURIComponent(id)}/thread?page=${page}`).then(result=>{if(active){setData(result);requestAnimationFrame(()=>{if(prose.current)prose.current.scrollTop=Number(localStorage.getItem(`phone-reader-position:${id}:${page}`))||0;});}}).catch(()=>{if(active)setError('会话读取失败，请重试。');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[id,page]);
  return <div className={`phone-thread ${light?'is-light':''}`} ref={root}>
    <div className="phone-thread-toolbar"><label>字号 <select aria-label="阅读字号" value={font} onChange={e=>{const n=Number(e.target.value);setFont(n);localStorage.setItem('phone-reader-font',String(n));}}>{[14,16,18,20].map(n=><option key={n}>{n}</option>)}</select></label><button className="btn btn-sm" onClick={()=>{setLight(v=>!v);localStorage.setItem('phone-reader-light',String(!light));}}>{light?'深色':'浅色'}</button><button className="btn btn-sm" onClick={toggle}>{fullscreen?'退出全屏':'全屏阅读'}</button><button className="btn btn-sm" onClick={()=>{setPage(Math.max(1,Math.ceil((data?.total||1)/30)));}}>最新一页</button></div>
    {data?.grouping==='historical'&&<p className="phone-thread-note">按日期分组：同用户、角色、来源与分支；此类记录未留存真实会话 ID。</p>}
    {loading&&<p role="status">正在读取连续对话…</p>}{error&&<p role="alert">{error}</p>}
    <div className="phone-thread-prose" ref={prose} style={{fontSize:font}} onScroll={e=>localStorage.setItem(`phone-reader-position:${id}:${page}`,String(e.currentTarget.scrollTop))}>
      {data?.items.map((row,i)=><section className="phone-thread-turn" key={row.id}><header><time>{new Date(row.createdAt).toLocaleString()}</time><small>第 {(page-1)*30+i+1} 次调用{row.status==='complete'?'':` · ${row.status==='cancelled'?'已取消':row.errorCode||row.status}`}{row.truncated?' · 留存不完整':''}</small></header><RecordReader value={latestUserInput(row.request)} label="用户"/><PhoneResponse value={row.response}/><details><summary>本次调用与上下文</summary><p>{row.model} · {row.id}</p><RecordReader value={row.request}/></details></section>)}
    </div>
    {data&&<Pagination page={page} total={data.total} pageSize={data.pageSize} loading={loading} onChange={setPage}/>}
  </div>;
}
