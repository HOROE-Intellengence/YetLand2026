import { useEffect, useState } from 'react';
import { Cpu, Circle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

interface Check {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  hint: string;
  fixHint?: string;
}

interface DiagnosticsData {
  ts: string;
  summary: { pass: number; warn: number; fail: number; total: number };
  checks: Check[];
}

const statusIcon = (s: string) => {
  if (s === 'pass') return <CheckCircle size={16} style={{ color: 'var(--ok)' }} />;
  if (s === 'fail') return <XCircle size={16} style={{ color: 'var(--danger)' }} />;
  return <Circle size={16} style={{ color: 'var(--gold-light)' }} />;
};

const statusBadge = (s: string) => {
  if (s === 'pass') return <span className="badge badge-ok">pass</span>;
  if (s === 'fail') return <span className="badge badge-danger">fail</span>;
  return <span className="badge badge-warn">warn</span>;
};

export function Diagnostics() {
  const { error: toastErr } = useToast();
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const d = await api.get<DiagnosticsData>('/api/admin/diagnostics');
      setData(d);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载诊断数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="state-placeholder"><Cpu size={32} /><span>加载诊断数据...</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  const s = data!.summary;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>诊断</h2>
        <button className="btn" onClick={load} title="刷新诊断">
          <RefreshCw size={14} /> 刷新
        </button>
      </div>
      <p style={{ color: 'var(--paper-dim)', marginBottom: 16, fontSize: 14 }}>
        检查 .env、LLM key、ADMIN_TOKEN、prompt 资产、示例数据等常见问题。
      </p>

      <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        <div className="metric">
          <div className="metric-label">通过</div>
          <div className="metric-value" style={{ color: 'var(--ok)' }}>{s.pass}</div>
        </div>
        <div className="metric">
          <div className="metric-label">警告</div>
          <div className="metric-value" style={{ color: 'var(--gold-light)' }}>{s.warn}</div>
        </div>
        <div className="metric">
          <div className="metric-label">失败</div>
          <div className="metric-value" style={{ color: 'var(--danger)' }}>{s.fail}</div>
        </div>
      </div>

      <div className="card">
        <h3>检查清单</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {data!.checks.map((check) => (
            <div
              key={check.id}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '10px 14px', borderRadius: 8,
                background: check.status === 'fail' ? 'var(--danger-bg, rgba(220,38,38,0.08))'
                  : check.status === 'warn' ? 'var(--warn-bg, rgba(234,179,8,0.08))'
                  : 'var(--surface)',
              }}
            >
              {statusIcon(check.status)}
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 500 }}>{check.label}</span>
                  {statusBadge(check.status)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--paper-dim)', marginTop: 2 }}>{check.hint}</div>
                {check.fixHint && <div style={{ fontSize: 12, color: 'var(--gold-light)', marginTop: 2 }}>{check.fixHint}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--paper-dim)', marginTop: 12 }}>
        诊断时间：{data!.ts}
      </div>
    </div>
  );
}
