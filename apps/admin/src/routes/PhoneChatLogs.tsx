import {useEffect,useState} from 'react';
import {api} from '../api/client';
type Row={id:string;userId:string;characterId:string;branchId:string;model:string;createdAt:string;status:string;elapsedMs:number;upstreamStatus:number|null;errorCode:string|null;truncated:number;request?:string;response?:string};
type Page={items:Row[];total:number;pageSize:number};
const statuses:Record<string,string>={processing:'处理中',complete:'完成',failed:'失败',cancelled:'已取消',interrupted:'服务重启中断'};
export function PhoneChatLogs(){
 const [data,setData]=useState<Page|null>(null),[detail,setDetail]=useState<Row|null>(null),[page,setPage]=useState(1),[filter,setFilter]=useState(''),[userId,setUserId]=useState(''),[revision,setRevision]=useState(0),[error,setError]=useState('');
 useEffect(()=>{let active=true;setError('');api.get<Page>(`/api/admin/phone-chat-logs?page=${page}&userId=${encodeURIComponent(userId)}`).then(d=>{if(active)setData(d)}).catch(()=>{if(active)setError('记录加载失败')});return()=>{active=false};},[page,userId,revision]);
 return <section><h1>小手机聊天记录</h1><p>服务端模型调用记录，包含用户、角色、输入输出、耗时及失败原因。仅管理员可查；超过记录长度上限会标记截断，不影响聊天输出。</p>
 <form onSubmit={e=>{e.preventDefault();setPage(1);setUserId(filter);setDetail(null)}} style={{display:'flex',gap:8}}><input aria-label="用户 ID" placeholder="按用户 ID 筛选" value={filter} onChange={e=>setFilter(e.target.value)}/><button className="btn">筛选</button><button type="button" className="btn" onClick={()=>setRevision(v=>v+1)}>刷新</button></form>
 {error&&<p role="alert">{error}</p>}
 <table style={{width:'100%',marginTop:16}}><thead><tr><th>时间 / 用户</th><th>角色 / 模型</th><th>状态 / 耗时</th><th>详情</th></tr></thead><tbody>{data?.items.map(row=><tr key={row.id}><td>{new Date(row.createdAt).toLocaleString()}<br/>{row.userId}</td><td>{row.characterId}<br/>{row.model}</td><td>{statuses[row.status]||row.status} · {(row.elapsedMs/1000).toFixed(1)} 秒<br/>{row.errorCode}</td><td><button className="btn" onClick={()=>{setError('');api.get<Row>('/api/admin/phone-chat-logs/'+row.id).then(setDetail).catch(()=>setError('详情加载失败'))}}>查看</button></td></tr>)}</tbody></table>
 <div style={{display:'flex',gap:12,marginTop:16}}><button className="btn" disabled={page<=1} onClick={()=>setPage(v=>v-1)}>上一页</button><span>第 {page} 页 · 共 {data?.total??0} 条</span><button className="btn" disabled={!data||page*data.pageSize>=data.total} onClick={()=>setPage(v=>v+1)}>下一页</button></div>
 {detail&&<article><h2>调用详情</h2><p>{detail.id} · {detail.branchId||'主线'} · HTTP {detail.upstreamStatus??'未返回'}{detail.truncated?' · 记录已截断':''}</p><h3>输入消息</h3><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{detail.request}</pre><h3>模型原始输出</h3><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{detail.response||'无输出'}</pre></article>}
 </section>;
}
