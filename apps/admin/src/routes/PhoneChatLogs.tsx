import { useEffect, useRef, useState } from 'react';
import { PhoneChatLogDetailSchema, PhoneChatLogsPageSchema, type PhoneChatLogDetail, type PhoneChatLogsPage, type PhoneChatLogsQuery } from '@yelan/shared';
import { api } from '../api/client';
import { RecordReader } from '../components/RecordReader';
import { latestUserInput } from '../lib/record-reader';
import { Pagination } from '../components/Pagination';
import './PhoneChatLogs.css';
import { phoneSourceNames,phoneSourceLabel } from '@yelan/shared';
import { PhoneThreadReader, PhoneResponse } from '../components/PhoneThreadReader';

type Filters = Omit<PhoneChatLogsQuery, 'page'>;
const statuses: Record<string, string> = { processing: '处理中', complete: '完成', failed: '失败', cancelled: '已取消', interrupted: '服务重启中断' };
export function PhoneChatLogs() {
  const detailRequest = useRef(0), pageSelection = useRef<'first' | 'last'>('first');
  const [data, setData] = useState<PhoneChatLogsPage | null>(null);
  const [detail, setDetail] = useState<PhoneChatLogDetail | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1), [revision, setRevision] = useState(0);
  const [detailRevision, setDetailRevision] = useState(0);
  const [filters, setFilters] = useState<Filters>({grouped:'true'});
  const [source,setSource]=useState(''),[query,setQuery]=useState(''),[from,setFrom]=useState(''),[to,setTo]=useState(''),[view,setView]=useState('thread');
  const [user, setUser] = useState(''), [character, setCharacter] = useState(''), [status, setStatus] = useState('');
  const [scopeLabel, setScopeLabel] = useState('');
  const [loading, setLoading] = useState(true), [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState(''), [detailError, setDetailError] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData(null); setSelectedId(null); setDetail(null); detailRequest.current++;
    const params = new URLSearchParams({ page: String(page) });
    for (const [key, value] of Object.entries(filters)) if (value !== undefined) params.set(key, value);
    void api.get<unknown>(`/api/admin/phone-chat-logs?${params}`)
      .then(value => {
        if (!active) return;
        const next = PhoneChatLogsPageSchema.parse(value);
        setData(next);
        setSelectedId((pageSelection.current === 'last' ? next.items.at(-1) : next.items[0])?.id ?? null);
        pageSelection.current = 'first';
      })
      .catch(() => { if (active) setError('记录加载失败，请重试。'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [page, filters, revision]);
  useEffect(() => {
    let active = true;
    const request = ++detailRequest.current;
    setDetail(null); setDetailError(''); setDetailLoading(Boolean(selectedId)&&view==='call');
    if (!selectedId||view!=='call') return;
    void api.get<unknown>(`/api/admin/phone-chat-logs/${encodeURIComponent(selectedId)}`)
      .then(value => { if (active && request === detailRequest.current) setDetail(PhoneChatLogDetailSchema.parse(value)); })
      .catch(() => { if (active && request === detailRequest.current) setDetailError('正文加载失败，请重试。'); })
      .finally(() => { if (active && request === detailRequest.current) setDetailLoading(false); });
    return () => { active = false; };
  }, [selectedId, detailRevision,view]);
  function select(id: string) {
    detailRequest.current++; setDetail(null); setDetailLoading(true); setSelectedId(id);
  }
  function changePage(next: number, selection: 'first' | 'last' = 'first') {
    detailRequest.current++; pageSelection.current = selection; setLoading(true); setDetail(null); setSelectedId(null); setPage(next);
  }
  function search(next: Filters, label = '') {
    detailRequest.current++; pageSelection.current = 'first'; setDetail(null); setSelectedId(null); setLoading(true);
    setPage(1); setFilters(next); setScopeLabel(label);
  }
  const rows = data?.items ?? [], index = rows.findIndex(row => row.id === selectedId);
  const selected = rows[index];
  const position = index < 0 ? 0 : (page - 1) * (data?.pageSize ?? 30) + index + 1;
  const previous = !loading && position > 1, next = !loading && position > 0 && position < (data?.total ?? 0);
  function move(direction: -1 | 1) {
    const row = rows[index + direction];
    if (row) select(row.id);
    else changePage(page + direction, direction < 0 ? 'last' : 'first');
  }
  return <section className="phone-chat-logs">
    <h2>小手机聊天记录</h2>
    <p className="text-muted">按来源、用户、角色、状态与时间定位会话，点击左侧摘要按时间连续阅读。每轮的历史上下文可按需展开。</p>
    <form className="phone-log-filters" onSubmit={event => {
      event.preventDefault(); search({ grouped:'true',user: user.trim() || undefined, character: character.trim() || undefined, status: status as Filters['status'] || undefined,sourceApp:source||undefined,q:query.trim()||undefined,from:from?new Date(from).toISOString():undefined,to:to?new Date(to).toISOString():undefined });
    }}>
      <input aria-label="用户名或用户 ID" placeholder="用户名 / 用户 ID" value={user} onChange={event => setUser(event.target.value)} maxLength={128} />
      <input aria-label="角色名称或角色 ID" placeholder="角色名称 / 角色 ID" value={character} onChange={event => setCharacter(event.target.value)} maxLength={128} />
      <select aria-label="调用状态" value={status} onChange={event => setStatus(event.target.value)}><option value="">全部状态</option>{Object.entries(statuses).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      <select aria-label="记录来源" value={source} onChange={e=>setSource(e.target.value)}><option value="">全部来源</option>{(data?.sources.length?data.sources:Object.keys(phoneSourceNames).map(id=>({id,count:0}))).map(s=><option key={s.id} value={s.id}>{phoneSourceLabel(s.id)}{s.count?` · ${s.count}`:''}</option>)}</select>
      <input aria-label="搜索对话正文" placeholder="搜索提问与回复" value={query} onChange={e=>setQuery(e.target.value)} maxLength={200}/>
      <input aria-label="开始时间" type="datetime-local" value={from} onChange={e=>setFrom(e.target.value)}/><input aria-label="结束时间" type="datetime-local" value={to} onChange={e=>setTo(e.target.value)}/>
      <button className="btn btn-primary">筛选</button>
      <button type="button" className="btn" onClick={() => { setUser(''); setCharacter(''); setStatus('');setSource('');setQuery('');setFrom('');setTo(''); search({grouped:'true'}); }}>清空筛选</button>
      <button type="button" className="btn" disabled={loading} onClick={() => setRevision(value => value + 1)}>刷新</button>
    </form>
    {scopeLabel && <p className="phone-log-scope">当前范围：{scopeLabel}</p>}
    {error && <p role="alert">{error}</p>}
    <div className="phone-log-layout">
      <div className="phone-log-list" aria-label="聊天记录列表" aria-busy={loading}>
        {loading ? <p className="state-placeholder" role="status">正在加载记录…</p> : !rows.length ? <p className="state-placeholder">没有符合条件的聊天记录。</p> : rows.map(row => <button
          key={row.id} type="button" className="phone-log-row" aria-pressed={row.id === selectedId} onClick={() => { if (row.id !== selectedId) select(row.id); }}>
          <span className="phone-log-row-top"><strong title={`用户 ID：${row.userId}`}>{row.userName}</strong><span className={`phone-log-status phone-log-status-${row.status}`}>{statuses[row.status]}</span></span>
          <span className="phone-log-identity">{row.characterName} · {phoneSourceLabel(row.sourceApp)}{row.sourceInferred?'（历史识别）':''} · {row.groupSize||1} 次{filters.q||filters.status||filters.from||filters.to?'匹配':''}调用</span>
          <span className="phone-log-preview phone-log-input"><b>用户</b> {row.inputPreview || '无用户文本'}</span>
          <span className="phone-log-preview"><b>回复</b> {row.outputPreview || (row.status === 'processing' ? '正在生成…' : row.errorCode || '无回复正文')}</span>
          <span className="phone-log-meta">{new Date(row.createdAt).toLocaleString()} · {(row.elapsedMs / 1000).toFixed(1)} 秒{row.truncated ? ' · 留存不完整' : ''} · {row.userId}</span>
        </button>)}
      </div>
      <article className="phone-log-reader" aria-label="对话正文" aria-busy={detailLoading}>
        <header className="phone-log-reader-header">
          <div><strong>{selected ? `${selected.userName} · ${selected.characterName}` : '对话正文'}</strong><small>{position ? `第 ${position} / ${data?.total} 组 · 最新在前` : '选择一组记录开始阅读'}</small></div>
          <div className="phone-log-reader-actions">
            <button type="button" className="btn btn-sm" disabled={!previous} onClick={() => move(-1)}>上一组</button>
            <button type="button" className="btn btn-sm" disabled={!next} onClick={() => move(1)}>下一组</button>
            <button type="button" className="btn btn-sm" onClick={()=>setView(v=>v==='thread'?'call':'thread')}>{view==='thread'?'单次调用':'连续阅读'}</button>
          </div>
        </header>
        <div className="phone-log-reader-body" key={selectedId ?? 'empty'}>
          {detailLoading && <p role="status">正在读取正文…</p>}
          {detailError && <p role="alert">{detailError} <button className="btn btn-sm" onClick={() => setDetailRevision(value => value + 1)}>重试</button></p>}
          {!selected && !loading && <p className="text-muted">左侧显示输入与回复摘要，无需逐条打开查找。</p>}
          {selectedId&&view==='thread'&&<PhoneThreadReader key={selectedId} id={selectedId}/>}
          {detail && view==='call' && <>
            <div className="phone-log-detail-meta">
              <p>{new Date(detail.createdAt).toLocaleString()} · {statuses[detail.status]} · {(detail.elapsedMs / 1000).toFixed(1)} 秒</p>
              <p>用户：{detail.userName} <small>（{detail.userId}）</small><br />角色：{detail.characterName} <small>（{detail.characterId}）</small><br />分支：{detail.branchId || '主线'}</p>
              <button className="btn btn-sm" onClick={() => { setUser(''); setCharacter(''); setStatus(''); search({ grouped:'true',userId: detail.userId, characterId: detail.characterId, branchId: detail.branchId }, `${detail.userName} · ${detail.characterName} · ${detail.branchId || '主线'}`); }}>只看此用户与角色的当前分支</button>
            </div>
            {detail.errorCode && <p className="phone-log-error">失败原因：{detail.errorCode}{detail.upstreamStatus ? ` · HTTP ${detail.upstreamStatus}` : ''}</p>}
            {Boolean(detail.truncated) && <p role="status">留存内容超过长度上限，以下正文可能不完整。</p>}
            <RecordReader value={latestUserInput(detail.request)} label="用户" />
            <PhoneResponse value={detail.response}/>
            <details><summary>历史上下文与系统设定</summary><RecordReader value={detail.request} label="用户" /></details>
            <details className="phone-log-technical"><summary>调用信息</summary><p>模型：{detail.model}<br />记录 ID：{detail.id}</p></details>
          </>}
        </div>
      </article>
    </div>
    {!error && <Pagination page={page} total={data?.total ?? 0} pageSize={data?.pageSize ?? 30} loading={loading || !data} onChange={changePage} />}
  </section>;
}
