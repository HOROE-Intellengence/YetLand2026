import { useEffect, useState } from 'react';
import { Brain, Circle, ArrowUp, ArrowDown } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

interface SidecarPrompt {
  key: string;
  currentValue: string;
  defaultValue: string;
}

interface SidecarConfig {
  enabled: Record<string, boolean>;
  order: string[];
  effectiveOrder: string[];
  runtimeNotes?: string[];
}

const SIDECAR_LABELS: Record<string, string> = {
  atmosphereJudge: '氛围判断（preMain — 主 AI 前）',
  outputStructurer: '结构拆句（postMain — 主 AI 后）',
  preferenceRecorder: '偏好记录（afterDone — 异步）',
  quotaEnding: '额度收束（quotaExhausted — 触发式）',
  contextCompressor: '上下文压缩（afterDone — 异步）',
};

export function SidecarPrompts() {
  const { success, error: toastErr } = useToast();
  const [prompts, setPrompts] = useState<SidecarPrompt[]>([]);
  const [config, setConfig] = useState<SidecarConfig>({ enabled: {}, order: [], effectiveOrder: [] });
  const [editing, setEditing] = useState<SidecarPrompt | null>(null);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const [promptData, configData] = await Promise.all([
        api.get<{ prompts: SidecarPrompt[] }>('/api/admin/sidecar-prompts'),
        api.get<SidecarConfig>('/api/admin/sidecar-config'),
      ]);
      setPrompts(promptData.prompts);
      setConfig(configData);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载侧袋配置失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function savePrompt() {
    if (!editing || !reason.trim()) return;
    try {
      await api.patch(`/api/admin/sidecar-prompts/${encodeURIComponent(editing.key)}`, {
        value,
        reason,
      });
      success('侧袋 prompt 已保存');
      setEditing(null);
      setReason('');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function toggleEnabled(key: string, enabled: boolean) {
    if (!reason.trim()) {
      toastErr('请先填写变更原因');
      return;
    }
    try {
      const resp = await api.patch<SidecarConfig & { ok: boolean }>('/api/admin/sidecar-config', {
        enabled: { [key]: enabled },
        reason: reason.trim(),
      });
      setConfig(resp);
      success(`${SIDECAR_LABELS[key]?.split('（')[0] ?? key} ${enabled ? '已启用' : '已禁用'}`);
      setReason('');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function moveOrder(key: string, direction: 'up' | 'down') {
    if (!reason.trim()) {
      toastErr('请先填写变更原因');
      return;
    }
    const idx = config.order.indexOf(key);
    if (idx < 0) return;
    const newOrder = [...config.order];
    if (direction === 'up' && idx > 0) {
      [newOrder[idx - 1], newOrder[idx]] = [newOrder[idx]!, newOrder[idx - 1]!];
    } else if (direction === 'down' && idx < newOrder.length - 1) {
      [newOrder[idx], newOrder[idx + 1]] = [newOrder[idx + 1]!, newOrder[idx]!];
    } else {
      return;
    }
    try {
      const resp = await api.patch<SidecarConfig & { ok: boolean }>('/api/admin/sidecar-config', {
        order: newOrder,
        reason: reason.trim(),
      });
      setConfig(resp);
      success('顺序已更新');
      setReason('');
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      toastErr(msg.includes('400') || msg.includes('INVALID') ? '顺序不合法：需包含全部 5 个不重复 key' : msg);
    }
  }

  const displayOrder = config.order.length > 0 ? config.order : prompts.map((p) => p.key);
  const effectiveSet = new Set(config.effectiveOrder);

  if (loading) return <div className="state-placeholder"><Brain size={32} /><span>加载侧袋配置...</span></div>;
  if (err) return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;

  return (
    <div>
      <h2>侧袋 AI 配置</h2>

      {/* ── 执行顺序 + 开关 ──────────────────────────────────────── */}
      <div className="card">
        <h3>执行顺序与开关</h3>
        <p style={{ fontSize: 12, color: 'var(--paper-dim)', marginBottom: 12 }}>
          按顺序执行侧袋 AI。禁用某个侧袋后自动跳过，不影响其他侧袋继续运行。
          右侧括号说明该侧袋在哪个 checkpoint 执行。
        </p>
        {displayOrder.map((key, idx) => {
          const isEnabled = config.enabled[key] ?? true;
          const inEffective = effectiveSet.has(key);
          return (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 12px',
                background: 'var(--bg-surface)',
                borderRadius: 6,
                marginBottom: 6,
                border: `1px solid ${inEffective ? (isEnabled ? 'var(--gold-light)' : 'var(--border-dim)') : 'var(--border-dim)'}`,
                opacity: inEffective ? 1 : 0.45,
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--paper-dim)', minWidth: 20 }}>
                {idx + 1}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14 }}>
                  {inEffective ? '▶ ' : ''}{SIDECAR_LABELS[key] ?? key}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--paper-dim)' }}>{key}</div>
              </div>
              <button
                className="btn btn-sm"
                disabled={idx === 0}
                onClick={() => moveOrder(key, 'up')}
                title="上移"
              >
                <ArrowUp size={12} />
              </button>
              <button
                className="btn btn-sm"
                disabled={idx === displayOrder.length - 1}
                onClick={() => moveOrder(key, 'down')}
                title="下移"
              >
                <ArrowDown size={12} />
              </button>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => toggleEnabled(key, e.target.checked)}
                />
                <span style={{ fontSize: 12 }}>{isEnabled ? '启用' : '禁用'}</span>
              </label>
            </div>
          );
        })}

        <div style={{ fontSize: 11, color: 'var(--paper-dim)', marginTop: 8 }}>
          有效执行链：{config.effectiveOrder.length > 0
            ? config.effectiveOrder.map((k) => SIDECAR_LABELS[k]?.split('（')[0] ?? k).join(' → ')
            : '（全部禁用）'}
        </div>

        {config.runtimeNotes && config.runtimeNotes.length > 0 && (
          <div style={{ fontSize: 11, color: 'var(--paper-dim)', marginTop: 4 }}>
            {config.runtimeNotes.map((note, i) => <div key={i}>⚠ {note}</div>)}
          </div>
        )}
      </div>

      {/* ── 变更原因 ────────────────────────────────────────────── */}
      <div className="card">
        <div className="field" style={{ marginBottom: 0 }}>
          <label>变更原因（修改开关或顺序前必填）</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：关掉上下文压缩测试其他侧袋"
          />
        </div>
      </div>

      {/* ── Prompt 管理 ──────────────────────────────────────────── */}
      <h2 style={{ marginTop: 24 }}>侧袋 Prompt</h2>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Key</th><th>当前内容</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>
            {prompts.map((row) => (
              <tr key={row.key}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{row.key}</td>
                <td style={{ maxWidth: 680 }}>{row.currentValue.slice(0, 160)}{row.currentValue.length > 160 ? '...' : ''}</td>
                <td>
                  <span className={`badge ${row.currentValue === row.defaultValue ? 'badge-ok' : 'badge-warn'}`}>
                    {row.currentValue === row.defaultValue ? '默认' : '已改'}
                  </span>
                </td>
                <td>
                  <button className="btn btn-sm" onClick={() => { setEditing(row); setValue(row.currentValue); setReason(''); }}>编辑</button>
                  <button className="btn btn-sm" onClick={() => { setEditing(row); setValue(row.defaultValue); setReason('reset to default'); }} style={{ marginLeft: 8 }}>恢复默认</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 860, width: '75vw' }}>
            <h2>编辑 {editing.key}</h2>
            <div className="field">
              <label>Prompt 内容</label>
              <textarea value={value} onChange={(e) => setValue(e.target.value)} style={{ minHeight: 360, fontFamily: 'var(--font-mono)' }} />
            </div>
            <div className="field">
              <label>reason</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} required />
            </div>
            <div className="modal-actions">
              <button className="btn" onClick={() => setEditing(null)}>取消</button>
              <button className="btn btn-primary" onClick={savePrompt} disabled={!reason.trim()}>保存</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
