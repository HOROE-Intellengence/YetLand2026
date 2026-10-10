import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { RecordReader } from '../components/RecordReader';
import { recordLabel } from '../lib/record-reader';
import { Pagination } from '../components/Pagination';
type Row = { key: string; kind: string; title: string; userId: string; userName?: string; deviceId: string; characterIds: string[]; receivedAt: string; localUpdatedAt: string; deleted: number; truncated: number; sections?: { title: string; text: string }[] };
type Page = { items: Row[]; total: number; pageSize: number };
const names: Record<string, string> = { role: '角色自定义', worldview: '世界观', story: '故事', vn: '视觉小说', cocreate: '共创作品', adventure: '冒险', diary: '日记', interview: '访谈', game: '自建游戏', 'custom-app': '自定义 App', reading: '阅读', note: '其他内容', diagnostic: '诊断记录' };
export function PhoneInspectionPage() { return <PhoneInspections />; }
export function PhoneInspections({ initialKind = '' }: { initialKind?: string }) {
  const detailRequest = useRef(0);
  const [kind, setKind] = useState(initialKind), [q, setQ] = useState(''), [filter, setFilter] = useState('');
  const [page, setPage] = useState(1), [refresh, setRefresh] = useState(0), [data, setData] = useState<Page | null>(null);
  const [detail, setDetail] = useState<Row | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true; setLoading(true); setError(''); setData(null); setDetail(null);
    api.get<Page>(`/api/admin/phone-inspections?page=${page}&kind=${encodeURIComponent(kind)}&q=${encodeURIComponent(q)}`)
      .then(value => { if (active) setData(value); }).catch(() => { if (active) setError('巡查记录加载失败，请重试'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; detailRequest.current++; };
  }, [kind, q, page, refresh]);
  async function view(row: Row) {
    const request = ++detailRequest.current;
    setDetail(null);
    try { const value = await api.get<Row>(`/api/admin/phone-inspections/${row.key}`); if (request === detailRequest.current) setDetail(value); }
    catch { if (request === detailRequest.current) setError('正文加载失败，请重试'); }
  }
  return <section className="phone-inspections">
    <h2>{initialKind === 'worldview' ? '用户世界观留存' : initialKind === 'role' ? '小手机角色自定义留存' : '小手机内容巡查'}</h2>
    <p className="text-muted">仅供运维读取。显示用户设备最近上报的留存版本，不提供云端同步、恢复或下发；设备离线期间的修改会在再次打开小手机后留存。正文只按文本显示。</p>
    <form style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }} onSubmit={event => { event.preventDefault(); setQ(filter); setPage(1); setDetail(null); }}>
      {!initialKind && <select aria-label="内容类型" value={kind} onChange={event => { setKind(event.target.value); setPage(1); setDetail(null); }}><option value="">全部类型</option>{Object.entries(names).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}
      <input aria-label="巡查搜索" value={filter} onChange={event => setFilter(event.target.value)} placeholder="作品标题、用户 ID 或角色 ID" />
      <button className="btn">搜索</button><button className="btn" type="button" onClick={() => setRefresh(value => value + 1)}>刷新</button>
    </form>
    {error && <p role="alert">{error}</p>}
    {loading ? <p>正在读取留存记录…</p> : !data?.items.length ? <div className="state-placeholder">暂无留存内容。用户使用新版小手机并保存内容后，会自动出现在这里。</div> : <div className="card" style={{ overflowX: 'auto' }}><table style={{ width: '100%' }}>
      <thead><tr><th>内容</th><th>用户 / 角色</th><th>最近留存</th><th>状态</th><th /></tr></thead>
      <tbody>{data.items.map(row => <tr key={row.key}><td><strong>{row.title}</strong><br /><small>{names[row.kind]}</small></td>
        <td>{row.userName || row.userId}<br /><small>{row.userId}</small><br /><small>{row.characterIds.join('、') || '未关联角色'}</small></td>
        <td>{new Date(row.receivedAt).toLocaleString()}<br /><small>设备 {row.deviceId.slice(0, 8)}</small></td>
        <td>{row.deleted ? '本地已移除，保留巡查版本' : '已留存'}{row.truncated ? ' · 正文较长，仅留存部分' : ''}</td>
        <td><button className="btn" onClick={() => void view(row)}>查看正文</button></td></tr>)}</tbody>
    </table></div>}
    {!error && <Pagination page={page} total={data?.total ?? 0} pageSize={data?.pageSize ?? 30} loading={loading || !data} onChange={next => { setLoading(true); setPage(next); setDetail(null); }} />}
    {detail && <article className="card" style={{ marginTop: 20 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><h2>{detail.title}</h2><button className="btn" onClick={() => setDetail(null)}>关闭正文</button></div>
      <p>{names[detail.kind]} · 用户 {detail.userId} · 留存于 {new Date(detail.receivedAt).toLocaleString()}</p>
      {detail.truncated ? <p role="status">内容超过留存长度上限，以下为部分正文；用户本地原文不受影响。</p> : null}
      {detail.sections?.map((section, index) => <section key={index}><RecordReader value={section.text} label={recordLabel(section.title)} /></section>)}
    </article>}
  </section>;
}
export function CharacterWorldviews() {
  const [rows, setRows] = useState<{ id: string; name: string; ownerUserId?: string; entries: { key: string; content: string; constant: boolean }[] }[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; api.get<{ characters: typeof rows }>('/api/admin/phone-inspections/worldviews').then(value => { if (active) setRows(value.characters); }).catch(() => { if (active) setError('角色世界观加载失败'); }); return () => { active = false; }; }, []);
  return <section><h2>角色世界观</h2><p className="text-muted">角色当前世界书及用户小手机世界观留存，供运维巡查读取。</p>{error && <p role="alert">{error}</p>}
    {rows.map(row => <details className="card" key={row.id}><summary>{row.name} · {row.entries.length} 条 · {row.ownerUserId || '平台角色'}</summary>{row.entries.map((entry, index) => <section key={index}><h3>{entry.constant ? '常驻设定' : entry.key || '世界观条目'}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{entry.content}</p></section>)}</details>)}
    {!rows.length && !error && <p>角色暂未添加世界书条目。</p>}<PhoneInspections initialKind="worldview" />
  </section>;
}
