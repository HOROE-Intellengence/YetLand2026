import { useEffect, useState } from 'react';
import { api, getAuthHeaders, getBase } from '../api/client';
import { DataTable, type Column } from '../components/DataTable';
import { formatUserLabel, useUserNameMap } from '../hooks/useUserNameMap';
import { formatDateTime } from '../lib/datetime';

interface Session {
  id: string; userId: string; characterId: string; voiceName: string; createdAt: string; turnCount: number;
}
interface AudioAsset { id: string; durationMs: number }
interface Turn {
  id: string; createdAt: string; status: string; errorCode: string | null;
  inputText: string; outputText: string; inputTranscriptComplete: boolean; outputTranscriptComplete: boolean;
  inputAudio: AudioAsset | null; outputAudio: AudioAsset | null;
}
interface Listing { rows: Session[]; total: number; page: number; pageSize: number }
const statuses: Record<string, string> = { complete: '已完成', processing: '处理中', failed: '失败', interrupted: '已中断' };
const voices: Record<string, string> = { Leda: '轻盈女声', Gacrux: '成熟女声', Puck: '清朗男声', Charon: '沉稳男声' };

function AudioPreview({ asset, label }: { asset: AudioAsset | null; label: string }) {
  const [requested, setRequested] = useState(false);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!requested || !asset) return;
    const controller = new AbortController();
    let objectUrl = '';
    void (async () => {
      try {
        const response = await fetch(`${getBase()}/api/admin/voice/assets/${encodeURIComponent(asset.id)}`, {
          headers: getAuthHeaders(), signal: controller.signal,
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw new Error(body.message || `音频加载失败（${response.status}）`);
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      } catch (e) {
        if (!controller.signal.aborted) { setError((e as Error).message); setRequested(false); }
      }
    })();
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [requested, asset]);
  if (!asset) return <p className="muted">无{label}音频</p>;
  return <div>
    <p className="muted">{label} · {(asset.durationMs / 1000).toFixed(1)} 秒</p>
    {url ? <audio aria-label={`${label}播放器`} controls preload="metadata" src={url}
      style={{ width: '100%', maxWidth: 420 }} onError={() => setError('浏览器无法播放此音频')} /> :
      <button className="btn btn-sm" disabled={requested} onClick={() => { setError(''); setRequested(true); }}>
        {requested ? '加载中…' : `加载${label}试听`}
      </button>}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function VoiceRecords() {
  const names = useUserNameMap();
  const [characters, setCharacters] = useState<Record<string, string>>({});
  const [userId, setUserId] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const [query, setQuery] = useState({ params: '', page: 1, revision: 0 });
  const [list, setList] = useState<Listing | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [selected, setSelected] = useState<Session | null>(null);
  const [turns, setTurns] = useState<Turn[] | null>(null), [detailError, setDetailError] = useState('');
  const [detailRevision, setDetailRevision] = useState(0);

  useEffect(() => {
    let active = true;
    api.get<{ characters: { id: string; slug: string; name: string }[] }>('/api/admin/characters')
      .then(data => { if (active) setCharacters(Object.fromEntries(data.characters.flatMap(c => [[c.id, c.name], [c.slug, c.name]]))); })
      .catch(() => { /* Keep the stored character ID available if names cannot be loaded. */ });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    api.get<Listing>(`/api/admin/voice/sessions?${query.params}&page=${query.page}`)
      .then(data => { if (active) setList(data); })
      .catch(e => { if (active) { setError((e as Error).message); setList(null); } })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [query]);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setTurns(null); setDetailError('');
    api.get<{ turns: Turn[] }>(`/api/admin/voice/sessions/${encodeURIComponent(selected.id)}`)
      .then(data => { if (active) setTurns(data.turns); })
      .catch(e => { if (active) setDetailError((e as Error).message); });
    return () => { active = false; };
  }, [selected, detailRevision]);

  const columns: Column<Session>[] = [
    { key: '_mode', header: '模式', render: row => row.id.startsWith('hq_') ? '语音（高质量）' : '语音' },
    { key: 'createdAt', header: '开始时间', render: row => formatDateTime(row.createdAt) },
    { key: 'userId', header: '用户', render: row => <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{formatUserLabel(row.userId, names)}</span> },
    { key: 'characterId', header: '角色', render: row => characters[row.characterId] ?? row.characterId },
    { key: 'voiceName', header: '音色', render: row => voices[row.voiceName] ?? row.voiceName },
    { key: 'turnCount', header: '轮数' },
    { key: '_detail', header: '详情', render: row => <button className="btn btn-sm" onClick={() => { setTurns(null); setDetailError(''); setSelected(row); }}>查看</button> },
  ];
  return <div>
    <h2>语音记录</h2>
    <form style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12, marginBottom: 16 }} onSubmit={e => {
      e.preventDefault();
      if (from && to && from > to) { setError('开始日期不能晚于结束日期'); return; }
      const params = new URLSearchParams();
      if (userId.trim()) params.set('userId', userId.trim());
      if (from) params.set('from', new Date(`${from}T00:00:00+08:00`).toISOString());
      if (to) params.set('to', new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86400000).toISOString());
      setQuery(q => ({ params: params.toString(), page: 1, revision: q.revision + 1 }));
    }}>
      <label>用户 ID<input value={userId} onChange={e => setUserId(e.target.value)} placeholder="全部用户" /></label>
      <label>开始日期<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
      <label>结束日期<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      <button className="btn" type="submit" disabled={loading}>筛选 / 刷新</button>
    </form>
    <p className="muted">按会话开始日期筛选，时间统一为北京时间（UTC+8）。</p>
    {error && <p role="alert">{error}</p>}
    {loading ? <p>加载语音记录…</p> : list && <>
      <DataTable columns={columns} rows={list.rows} rowKey={row => row.id} emptyMessage="暂无语音记录。" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 }}>
        <span>共 {list.total} 个会话 · 第 {list.page} 页</span>
        <button className="btn btn-sm" disabled={list.page <= 1} onClick={() => setQuery(q => ({ ...q, page: q.page - 1 }))}>上一页</button>
        <button className="btn btn-sm" disabled={list.page * list.pageSize >= list.total} onClick={() => setQuery(q => ({ ...q, page: q.page + 1 }))}>下一页</button>
      </div>
    </>}
    {selected && <div className="modal-overlay" onClick={() => setSelected(null)}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="语音会话详情" onClick={e => e.stopPropagation()}
        onKeyDown={e => { if (e.key === 'Escape') setSelected(null); }}
        style={{ width: 'min(900px, 94vw)', maxWidth: 900, maxHeight: '85vh', overflow: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <h2>语音会话详情</h2><button autoFocus className="btn" onClick={() => setSelected(null)}>关闭</button>
        </div>
        <p className="muted" style={{ overflowWrap: 'anywhere' }}>{selected.id} · {characters[selected.characterId] ?? selected.characterId} · {voices[selected.voiceName] ?? selected.voiceName}</p>
        <button className="btn btn-sm" onClick={() => setDetailRevision(v => v + 1)}>刷新详情</button>
        {detailError ? <p role="alert">{detailError}</p> : !turns ? <p>加载详情…</p> : !turns.length ? <p>此会话尚无语音轮次。</p> :
          turns.map((turn, index) => <section key={turn.id} style={{ borderTop: '1px solid var(--border)', padding: '18px 0' }}>
            <h3>第 {index + 1} 轮 · {statuses[turn.status] ?? turn.status}</h3>
            <p className="muted">{formatDateTime(turn.createdAt)}</p>
            {turn.errorCode && <p role="status">失败原因：{turn.errorCode}</p>}
            <h4>用户</h4>
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.inputText || '暂无转写文本'}{!turn.inputTranscriptComplete && turn.inputText ? '（转写未完成）' : ''}</p>
            <AudioPreview asset={turn.inputAudio} label="用户录音" />
            <h4>AI 回复</h4>
            <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{turn.outputText || '暂无回复文本'}{!turn.outputTranscriptComplete && turn.outputText ? '（转写未完成）' : ''}</p>
            <AudioPreview asset={turn.outputAudio} label="AI 语音" />
          </section>)}
      </div>
    </div>}
  </div>;
}
