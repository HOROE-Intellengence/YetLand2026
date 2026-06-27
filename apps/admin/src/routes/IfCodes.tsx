import { useEffect, useState } from 'react';
import { Key, Plus, Circle } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { formatUserLabel, useUserNameMap } from '../hooks/useUserNameMap';

interface IfCode {
  code: string;
  boundary: 1 | 2 | 3 | 4 | 5;
  source: string;
  active: boolean;
  temperature?: 1 | 2 | 3 | 4 | 5;
}

interface Redemption {
  userId: string;
  code: string;
  ts: string;
}

export function IfCodes() {
  const { success, error: toastErr } = useToast();
  const userNames = useUserNameMap();
  const [codes, setCodes] = useState<IfCode[]>([]);
  const [redemptions, setRedemptions] = useState<Redemption[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState({ code: '', boundary: 3, temperature: 0, source: 'ops', reason: '' });

  const load = async () => {
    try {
      const data = await api.get<{ codes: IfCode[]; redemptions: Redemption[] }>('/api/admin/if-codes');
      setCodes(data.codes);
      setRedemptions(data.redemptions);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载暗号失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function createCode(e: React.FormEvent) {
    e.preventDefault();
    try {
      await api.post('/api/admin/if-codes', {
        code: form.code,
        boundary: form.boundary,
        ...(form.temperature > 0 ? { temperature: form.temperature } : {}),
        source: form.source,
        reason: form.reason,
      });
      success('暗号已创建');
      setForm({ code: '', boundary: 3, temperature: 0, source: 'ops', reason: '' });
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function toggleCode(row: IfCode) {
    try {
      await api.patch(`/api/admin/if-codes/${encodeURIComponent(row.code)}`, {
        active: !row.active,
        reason: 'admin toggle',
      });
      success(row.active ? '暗号已停用' : '暗号已启用');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function deleteCode(row: IfCode) {
    if (!window.confirm(`删除暗号 ${row.code}？`)) return;
    try {
      await api.delete(`/api/admin/if-codes/${encodeURIComponent(row.code)}?reason=${encodeURIComponent('admin delete')}`);
      success('暗号已删除');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  if (loading) return <div className="state-placeholder"><Key size={32} /><span>加载暗号...</span></div>;
  if (err) return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;

  return (
    <div>
      <h2>IF 暗号</h2>
      <div className="card">
        <h3>新增暗号</h3>
        <form onSubmit={createCode} className="metrics" style={{ alignItems: 'end', marginBottom: 0 }}>
          <div className="field">
            <label>暗号</label>
            <input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required placeholder="YELAN-MOON" />
          </div>
          <div className="field">
            <label>破甲等级</label>
            <select value={form.boundary} onChange={(e) => setForm({ ...form, boundary: Number(e.target.value) })}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>B{n}</option>)}
            </select>
          </div>
          <div className="field">
            <label>瞬时升温</label>
            <select value={form.temperature} onChange={(e) => setForm({ ...form, temperature: Number(e.target.value) })}>
              <option value={0}>不强制</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>温{n}</option>)}
            </select>
          </div>
          <div className="field">
            <label>来源</label>
            <input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} required />
          </div>
          <div className="field">
            <label>reason</label>
            <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} required />
          </div>
          <button className="btn btn-primary" type="submit"><Plus size={14} />创建</button>
        </form>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>暗号</th><th>破甲</th><th>瞬时升温</th><th>来源</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {codes.map((row) => (
              <tr key={row.code}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.code}</td>
                <td>B{row.boundary}</td>
                <td>{row.temperature != null ? `温${row.temperature}` : '—'}</td>
                <td>{row.source}</td>
                <td><span className={`badge ${row.active ? 'badge-ok' : 'badge-danger'}`}>{row.active ? '启用' : '停用'}</span></td>
                <td>
                  <button className="btn btn-sm" onClick={() => toggleCode(row)}>{row.active ? '停用' : '启用'}</button>
                  <button className="btn btn-sm btn-danger" onClick={() => deleteCode(row)} style={{ marginLeft: 8 }}>删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>用户</th><th>暗号</th><th>时间</th></tr></thead>
          <tbody>
            {redemptions.map((row) => (
              <tr key={`${row.userId}-${row.code}-${row.ts}`}>
                <td style={{ whiteSpace: 'pre-wrap', fontFamily: userNames[row.userId] ? undefined : 'var(--font-mono)' }}>
                  {formatUserLabel(row.userId, userNames)}
                </td>
                <td>{row.code}</td>
                <td>{row.ts}</td>
              </tr>
            ))}
            {redemptions.length === 0 && <tr><td colSpan={3}>暂无兑换记录</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
