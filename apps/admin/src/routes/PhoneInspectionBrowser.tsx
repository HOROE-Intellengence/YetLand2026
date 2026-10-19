import { useEffect, useRef, useState } from 'react';
import type { PhoneInspectionPreview } from '@yelan/shared';
import { api } from '../api/client';
import { RecordReader } from '../components/RecordReader';
import { InspectionPreview } from '../components/InspectionPreview';
import { Pagination } from '../components/Pagination';
import './PhoneInspections.css';
type Row={key:string;kind:string;title:string;userId:string;userName?:string;deviceId:string;characterIds:string[];characterNames?:string[];receivedAt:string;deleted:number;truncated:number;summary?:string;wordCount?:number;contentState?:string;previewAvailable?:boolean;preview?:PhoneInspectionPreview|null;sections?:{title:string;text:string}[]};
type Page={items:Row[];total:number;pageSize:number;owners:{userId:string;userName:string;total:number}[]};
const names:Record<string,string>={chat:'聊天会话',role:'角色自定义',worldview:'世界观',story:'故事',vn:'视觉小说',cocreate:'共创作品',adventure:'冒险',diary:'日记',interview:'访谈',game:'游戏','custom-app':'自定义 App',reading:'阅读',note:'生活内容',diagnostic:'运行诊断'};
export function PhoneInspectionBrowser({initialKind='',ownerUserId}:{initialKind?:string;ownerUserId?:string}){
  const [kind,setKind]=useState(initialKind),[creator,setCreator]=useState(''),[search,setSearch]=useState(''),[q,setQ]=useState(''),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
  const [data,setData]=useState<Page|null>(null),[detail,setDetail]=useState<Row|null>(null),[selected,setSelected]=useState(''),[tab,setTab]=useState('preview');
  const [loading,setLoading]=useState(false),[detailLoading,setDetailLoading]=useState(false),[error,setError]=useState('');
  const request=useRef(0);
  const initialRecord=useRef(new URLSearchParams(window.location.hash.split('?')[1]||'').get('record')||'');
  useEffect(()=>{
    let active=true;request.current++;setLoading(true);setData(null);setDetail(null);setSelected('');setError('');
    const params=new URLSearchParams({page:String(page),kind,userId:ownerUserId??creator,q});
    void api.get<Page>(`/api/admin/phone-inspections?${params}`).then(result=>{if(active){setData(result);setSelected(initialRecord.current||result.items[0]?.key||'');initialRecord.current='';}}).catch(()=>{if(active)setError('巡查记录加载失败，请重试。');}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[page,kind,creator,ownerUserId,q,revision]);
  useEffect(()=>{
    const n=++request.current;let active=true;setDetail(null);setDetailLoading(Boolean(selected));setTab('preview');setError('');
    if(!selected)return;
    void api.get<Row>(`/api/admin/phone-inspections/${selected}`).then(row=>{if(active&&n===request.current)setDetail(row);}).catch(()=>{if(active&&n===request.current)setError('预览加载失败，请重试。');}).finally(()=>{if(active&&n===request.current)setDetailLoading(false);});
    return()=>{active=false;};
  },[selected,revision]);
  const reset=()=>{request.current++;setPage(1);setDetail(null);};
  return <section className="phone-inspection-browser">
    <h2>{initialKind==='worldview'?'用户世界观留存':initialKind==='role'?'小手机角色自定义留存':'内容巡查'}</h2>
    <p className="text-muted">阅读用户设备最近上报的作品与画面。预览状态和素材完整性以留存版本为准。</p>
    <form className="inspection-filters" onSubmit={e=>{e.preventDefault();reset();setQ(search.trim());}}>
      {!initialKind&&<select aria-label="内容类型" value={kind} onChange={e=>{reset();setKind(e.target.value);}}><option value="">全部内容</option>{Object.entries(names).map(([k,n])=><option key={k} value={k}>{n}</option>)}</select>}
      {ownerUserId===undefined&&<select aria-label="创建用户" value={creator} onChange={e=>{reset();setCreator(e.target.value);}}><option value="">全部用户</option>{data?.owners.map(o=><option value={o.userId} key={o.userId}>{o.userName} · {o.total} 条</option>)}</select>}
      <input aria-label="搜索巡查内容" placeholder="搜索标题、正文或角色 ID" value={search} onChange={e=>setSearch(e.target.value)}/><button className="btn">搜索</button><button type="button" className="btn" disabled={loading} onClick={()=>setRevision(r=>r+1)}>刷新</button>
    </form>
    {error&&<p role="alert">{error}</p>}
    <div className="inspection-browser-layout">
      <div className="inspection-work-list" aria-busy={loading}>
        {loading?<p role="status">正在加载留存…</p>:!data?.items.length?<p className="state-placeholder">暂无符合条件的留存。</p>:data.items.map(row=><button type="button" className="inspection-work" key={row.key} aria-pressed={row.key===selected} onClick={()=>setSelected(row.key)}>
          <span className="inspection-work-heading"><strong>{row.title}</strong><small>{names[row.kind]}</small></span>
          <span>{row.summary|| (row.previewAvailable?'可查看用户界面':row.contentState==='empty'?'没有正文留存':'查看留存详情')}</span>
          <small>{row.userName||row.userId} · {(row.characterNames||row.characterIds).join('、')||'未关联角色'}</small>
          <small>{new Date(row.receivedAt).toLocaleString()} · {row.contentState==='partial'?'部分预览':row.contentState==='empty'?'无正文':row.previewAvailable?'用户视角预览':`${row.wordCount??0} 字`}{row.deleted?' · 本地已移除':''}</small>
        </button>)}
      </div>
      <article className="inspection-work-reader" aria-busy={detailLoading}>
        {detailLoading?<p role="status">正在读取预览…</p>:detail?<>
          <header><h3>{detail.title}</h3><p>{detail.userName||detail.userId} · {names[detail.kind]} · {new Date(detail.receivedAt).toLocaleString()}</p></header>
          <div className="inspection-tabs">{[['preview','用户视角'],['reading','正文阅读'],['details','留存详情']].map(([k,n])=><button type="button" className="btn" key={k} aria-pressed={tab===k} onClick={()=>setTab(k!)}>{n}</button>)}</div>
          {Boolean(detail.truncated)&&<p className="inspection-missing">正文摘要达到长度上限。完整内容和资源请查看用户视角预览。</p>}
          {tab==='preview'&&(detail.preview?<InspectionPreview key={detail.key} recordKey={detail.key} preview={detail.preview} title={detail.title}/>:<><p className="inspection-missing">这是一条历史文本留存。原设备再次打开新版小手机后，可补传用户视角预览。</p>{detail.sections?.filter(s=>!/entryHtml|gameHtml|assets|manifest|settings|draft/.test(s.title)).map((s,i)=><RecordReader key={i} value={s.text} label={s.title}/>)}</>)}
          {tab==='reading'&&(detail.sections?.some(s=>s.text.trim())?detail.sections.map((s,i)=><details key={i} open={!/entryHtml|gameHtml|assets|manifest|settings|draft|permissions/.test(s.title)}><summary>{s.title}</summary><RecordReader value={s.text} label={s.title}/></details>):<p>本条记录没有正文留存。</p>)}
          {tab==='details'&&<dl><dt>用户</dt><dd>{detail.userName}（{detail.userId}）</dd><dt>关联角色</dt><dd>{(detail.characterNames||detail.characterIds).join('、')||'无'}</dd><dt>设备</dt><dd>{detail.deviceId}</dd><dt>状态</dt><dd>{detail.deleted?'本地已移除，保留巡查版本':'已留存'}</dd><dt>媒体</dt><dd>{Array.isArray(detail.preview?.data.archiveParts)?`共 ${Number(detail.preview?.data.resourceCount)||0} 个资源，请在用户视角查看完整性。`:<>{detail.preview?.assets.filter(a=>a.state==='stored').length??0} 个已留存；{detail.preview?.assets.filter(a=>a.state!=='stored').length??0} 个缺失或超限</>}</dd></dl>}
        </>:<p className="state-placeholder">选择左侧作品开始阅读。</p>}
      </article>
    </div>
    {!error&&<Pagination page={page} total={data?.total??0} pageSize={data?.pageSize??30} loading={loading||!data} onChange={setPage}/>}
  </section>;
}
