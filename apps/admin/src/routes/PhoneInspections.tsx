import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { PhoneInspectionBrowser } from './PhoneInspectionBrowser';
type Owner = { userId: string; userName: string; total: number };
export function PhoneInspectionPage() { return <PhoneInspectionBrowser />; }
export const PhoneInspections = PhoneInspectionBrowser;
export function CharacterWorldviews() {
  const [rows, setRows] = useState<{ id: string; name: string; origin?: string; ownerUserId?: string | null; ownerUserName?: string; entries: { key: string; content: string; constant: boolean }[] }[]>([]);
  const [owners, setOwners] = useState<Owner[]>([]), [creator, setCreator] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; api.get<{ characters: typeof rows; owners: Owner[] }>('/api/admin/phone-inspections/worldviews').then(value => { if (active) { setRows(value.characters); setOwners(value.owners); } }).catch(() => { if (active) setError('角色世界观加载失败'); }).finally(() => { if (active) setLoading(false); }); return () => { active = false; }; }, []);
  const groups = new Map<string, { id: string; userId?: string; name: string; rows: typeof rows; retained: number }>();
  for (const row of rows) {
    const id = row.ownerUserId || (row.origin === 'user' ? '__unknown__' : '__platform__');
    const group = groups.get(id) ?? { id, userId: row.ownerUserId || undefined, name: row.ownerUserName || (row.origin === 'user' ? '未知用户' : '平台创建'), rows: [], retained: 0 };
    group.rows.push(row); groups.set(id, group);
  }
  for (const owner of owners) {
    const group = groups.get(owner.userId) ?? { id: owner.userId, userId: owner.userId, name: owner.userName, rows: [], retained: 0 };
    group.retained = owner.total; groups.set(owner.userId, group);
  }
  return <section><h2>角色世界观</h2><p className="text-muted">角色当前世界书及用户小手机世界观留存，供运维巡查读取。</p>{error && <p role="alert">{error}</p>}
    <label className="field" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, margin: '16px 0' }}>创建用户
      <select aria-label="世界观创建用户" style={{ width: 'auto', maxWidth: '100%' }} value={creator} onChange={event => setCreator(event.target.value)}><option value="">全部创建用户</option>
        {[...groups.values()].map(group => <option key={group.id} value={group.id}>{group.name}{group.userId ? `（${group.userId}）` : ''}</option>)}
      </select>
    </label>
    {loading && <p>正在加载世界观…</p>}
    {[...groups.values()].filter(group => !creator || group.id === creator).map(group => <details className="card" key={group.id} open={Boolean(expanded[group.id])} onToggle={event => {
      const open = event.currentTarget.open;
      setExpanded(previous => previous[group.id] === open ? previous : { ...previous, [group.id]: open });
    }}>
      <summary style={{ cursor: 'pointer' }}>{group.name}{group.userId ? `（${group.userId}）` : ''} · {group.rows.length} 个角色 · {group.retained} 份留存</summary>
      {expanded[group.id] && <div style={{ marginTop: 16 }}>
        {group.rows.map(row => <details key={row.id} style={{ marginBottom: 16 }}><summary style={{ cursor: 'pointer' }}>{row.name} · {row.entries.length} 条世界书</summary>{row.entries.map((entry, index) => <section key={index} style={{ marginTop: 12 }}><h3>{entry.constant ? '常驻设定' : entry.key || '世界观条目'}</h3><p style={{ whiteSpace: 'pre-wrap' }}>{entry.content}</p></section>)}</details>)}
        {group.userId && group.retained > 0 && <PhoneInspections initialKind="worldview" ownerUserId={group.userId} />}
      </div>}
    </details>)}
    {!loading && !groups.size && !error && <p>暂无世界观内容。</p>}
  </section>;
}
