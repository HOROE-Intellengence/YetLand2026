import { useEffect, useRef, useState } from 'react';
import { HQ_VOICE_OPTIONS, type HqVoiceProfileId, type FishVoiceSettings, type FishCatalog } from '@yelan/shared';
import { api, getBase, getAuthHeaders } from '../api/client';
import './VoiceSettings.css';

const base = '/api/admin/voice-hq';
export function VoiceSettings() {
  const [data, setData] = useState<FishVoiceSettings | null>(null);
  const [reason, setReason] = useState('维护高质量语音音色');
  const [query, setQuery] = useState(''), [mine, setMine] = useState(false), [page, setPage] = useState(1);
  const [catalog, setCatalog] = useState<FishCatalog | null>(null);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false), [searching, setSearching] = useState(false), [previewing, setPreviewing] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [text, setText] = useState('今天过得怎么样？不用着急，先坐下来喝口水，我会在这里陪着你。');
  const [audio, setAudio] = useState('');
  const [testId, setTestId] = useState('');
  const audioUrl = useRef(''), controller = useRef<AbortController | null>(null);
  const alive = useRef(true), previewLock = useRef(false);
  function apply(value: FishVoiceSettings) { setData(value); setChoices(Object.fromEntries(value.slots.map(s => [s.category, s.referenceId ?? '']))); }
  useEffect(() => {
    alive.current = true;
    void api.get<FishVoiceSettings>(base).then(apply).catch(e => setError((e as Error).message));
    return () => { alive.current = false; controller.current?.abort(); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); };
  }, []);
  async function search(nextPage = 1) {
    setSearching(true); setError('');
    try {
      const params = new URLSearchParams({ title: query, self: String(mine), page: String(nextPage) });
      setCatalog(await api.get<FishCatalog>(`${base}/catalog?${params}`)); setPage(nextPage);
    } catch (e) { setError((e as Error).message); }
    finally { setSearching(false); }
  }
  async function bind(category: HqVoiceProfileId) {
    setBusy(true); setError(''); setNotice('');
    try { setData(await api.put<FishVoiceSettings>(`${base}/slots/${category}`, { referenceId: choices[category]?.trim() || null, speed: data?.slots.find(s => s.category === category)?.speed ?? 1, reason })); setNotice('默认音色已更新。'); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function preview(referenceId: string | null, speed = 1) {
    if (previewLock.current) return;
    previewLock.current = true; setPreviewing(true); setError('');
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); setAudio(''); audioUrl.current = '';
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await fetch(`${getBase()}${base}/preview`, { method: 'POST', signal: abort.signal,
        headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ referenceId, text, speed }) });
      if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.message || '试听失败'); }
      const blob = await response.blob(); if (!alive.current) return;
      audioUrl.current = URL.createObjectURL(blob); setAudio(audioUrl.current);
    } catch (e) { if (!abort.signal.aborted) setError((e as Error).message); }
    finally { previewLock.current = false; if (alive.current) setPreviewing(false); }
  }
  return <div className="voice-settings">
    <h2>语音配置与测试</h2>
    <p>Fish Audio · <strong>s2.1-pro-free</strong> · {data?.configured ? '后端密钥已配置' : '等待后端密钥配置'}</p>
    <p className="muted">填写四类默认音色的 Fish reference_id，保存后下一轮生效。留空使用 Fish 默认声音。</p>
    {error && <p role="alert" style={{ color: 'var(--danger, #d85a5a)' }}>{error}</p>}
    {notice && <p role="status">{notice}</p>}
    <label style={{ display: 'block', marginBottom: 16 }}>修改原因 <input aria-label="音色修改原因" value={reason} maxLength={500} onChange={e => setReason(e.target.value)} /></label>
    <h3>四类默认音色</h3>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))', gap: 12 }}>
      {HQ_VOICE_OPTIONS.map(option => <div key={option.value} className="card" style={{ padding: 16, border: '1px solid var(--border)', borderRadius: 8 }}>
        <label>{option.label}<input aria-label={`${option.label}默认音色 ID`} placeholder="手动填写 Fish reference_id" value={choices[option.value] ?? ''} maxLength={100} onChange={e => setChoices({ ...choices, [option.value]: e.target.value })} style={{ display: 'block', width: '100%', margin: '10px 0' }} /></label>
        <button className="btn btn-sm" disabled={busy || !reason.trim()} onClick={() => void bind(option.value)}>保存{option.label}</button>
      </div>)}
    </div>
    <h3>语音测试</h3>
    <label>测试音色 ID<input aria-label="测试音色 ID" placeholder="留空测试 Fish 默认声音" value={testId} maxLength={100} onChange={e => setTestId(e.target.value)} /></label>
    <textarea aria-label="音色试听文本" value={text} maxLength={300} onChange={e => setText(e.target.value)} style={{ width: '100%', minHeight: 65 }} />
    <p><button className="btn" disabled={previewing || !text.trim()} onClick={() => void preview(testId.trim() || null)}>{previewing ? '正在生成试听…' : '生成试听'}</button></p>
    {audio && <audio controls autoPlay src={audio} aria-label="Fish 音色试听播放器" style={{ width: '100%', maxWidth: 480 }} />}
    <h3>查找音色 · 仅供试听</h3>
    <form onSubmit={e => { e.preventDefault(); void search(); }} style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
      <input aria-label="搜索 Fish 音色" placeholder="音色名称，如：温柔、中文" value={query} maxLength={100} onChange={e => setQuery(e.target.value)} />
      <label><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} />只看当前 Fish 工作区</label>
      <button className="btn" disabled={searching}>{searching ? '搜索中…' : '搜索音色'}</button>
      <a href="https://fish.audio/discovery" target="_blank" rel="noreferrer">在 Fish 浏览</a>
    </form>
    {catalog && <>
      <p className="muted">第 {page} 页 · 上游返回 {catalog.total} 项</p>
      {catalog.items.map(v => <div key={v.referenceId} style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ flex: 1, minWidth: 200 }}><strong>{v.name}</strong><div className="muted">{v.languages.join(' / ')} · {v.referenceId}</div></div>
        <button className="btn btn-sm" disabled={previewing || !text.trim()} onClick={() => void preview(v.referenceId)}>试听</button>
        <button className="btn btn-sm" onClick={() => { setTestId(v.referenceId); setNotice('已填入测试 ID；不会修改四类默认项。'); }}>填入测试 ID</button>
      </div>)}
      <p><button className="btn btn-sm" disabled={searching || page <= 1} onClick={() => void search(page - 1)}>上一页</button> <button className="btn btn-sm" disabled={searching || !(catalog.hasMore ?? catalog.items.length === 20)} onClick={() => void search(page + 1)}>下一页</button></p>
    </>}
  </div>;
}
