import { useEffect, useState } from 'react';
import { ScrollText, Circle } from 'lucide-react';
import { AdminPolicyPatchSchema, type AdminPolicyPatch } from '@yelan/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

interface PolicyRow { key: string; value: unknown; label: string; group: string; updatedAt?: string }
interface PolicyGrouped { groups: Record<string, PolicyRow[]> }
interface PolicyList { policies: PolicyRow[] }

export function Policy() {
  const { success, error: toastErr } = useToast();
  const [policies, setPolicies] = useState<PolicyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<PolicyRow | null>(null);
  const [newValue, setNewValue] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const data = await api.get<PolicyGrouped>('/api/admin/policy?grouped=1');
      const all: PolicyRow[] = [];
      if (data.groups) {
        for (const [, rows] of Object.entries(data.groups)) {
          all.push(...rows);
        }
      }
      setPolicies(all);
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载策略失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleSave() {
    if (!editing || !reason) return;
    setSaving(true);
    try {
      let value: unknown = newValue;
      if (newValue === 'true') value = true;
      else if (newValue === 'false') value = false;
      else if (/^-?\d+$/.test(newValue)) value = Number(newValue);

      const body: AdminPolicyPatch = AdminPolicyPatchSchema.parse({ value, reason });
      await api.patch(`/api/admin/policy/${editing.key}`, body);
      success(`策略 ${editing.key} 已更新`);
      setEditing(null);
      setNewValue('');
      setReason('');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="state-placeholder"><ScrollText size={32} /><span>加载策略…</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }
  if (policies.length === 0) {
    return <div className="state-placeholder"><ScrollText size={32} /><span>暂无策略</span></div>;
  }

  const groups = new Map<string, PolicyRow[]>();
  for (const p of policies) {
    const g = (p as { group?: string }).group ?? '其他';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(p);
  }

  return (
    <div>
      <h2>策略管理</h2>
      {Array.from(groups.entries()).map(([group, rows]) => (
        <div className="card" key={group}>
          <h3>{group}</h3>
          <table>
            <thead>
              <tr><th>Key</th><th>当前值</th><th>标签</th><th>操作</th></tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.key}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{p.key}</td>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{JSON.stringify(p.value)}</td>
                  <td>{p.label}</td>
                  <td>
                    <button className="btn btn-sm" onClick={() => { setEditing(p); setNewValue(String(p.value)); setReason(''); }}>
                      编辑
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {/* Edit Modal */}
      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>编辑策略: {editing.key}</h2>
            <div className="field">
              <label>当前值</label>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 14, color: 'var(--gold-light)' }}>
                {JSON.stringify(editing.value)}
              </div>
            </div>
            <div className="field">
              <label>新值</label>
              <input value={newValue} onChange={(e) => setNewValue(e.target.value)} autoFocus />
              <div style={{ fontSize: 11, color: 'var(--paper-mute)', marginTop: 4 }}>
                支持: string / number / boolean (true/false)
              </div>
            </div>
            <div className="field">
              <label>变更原因（必填）</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="例如：调整免费额度为 30" />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setEditing(null)}>取消</button>
              <button className="btn btn-primary" onClick={handleSave} disabled={saving || !reason}>
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
