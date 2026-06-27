import { useEffect, useState } from 'react';
import { CheckCircle, Circle, XCircle, TestTube2, Database, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

interface Check {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  hint: string;
  fixHint?: string;
  fix?: { method: 'POST'; path: string; body?: unknown };
}

interface QuickAction {
  id: string;
  label: string;
  method: 'POST';
  path: string;
  body?: unknown;
}

interface DiagnosticsData {
  ts: string;
  summary: { pass: number; warn: number; fail: number; total: number };
  checks: Check[];
  quickActions: QuickAction[];
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

export function Setup() {
  const { success, error: toastErr } = useToast();
  const [data, setData] = useState<DiagnosticsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [actionLoading, setActionLoading] = useState('');

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

  async function runAction(action: QuickAction) {
    setActionLoading(action.id);
    try {
      const res = action.body
        ? await api.post<unknown>(action.path, action.body)
        : await api.post<unknown>(action.path);
      if (action.id === 'reload-config') {
        const r = res as {
          flagChanges?: { flag: string; from: boolean; to: boolean }[];
          readyProviders?: string[];
        };
        const changes = r.flagChanges ?? [];
        const summary = changes.length
          ? changes.map((x) => `${x.flag} ${x.from ? 'on' : 'off'}→${x.to ? 'on' : 'off'}`).join('、')
          : '无变更';
        success(`${action.label} 已完成 · ${summary} · ${r.readyProviders?.length ?? 0} provider ready`);
      } else {
        success(`${action.label} 已完成`);
      }
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setActionLoading('');
    }
  }

  async function runFix(check: Check) {
    if (!check.fix) return;
    setActionLoading(check.id);
    try {
      if (check.fix.body) {
        await api.post(check.fix.path, check.fix.body);
      } else {
        await api.post(check.fix.path);
      }
      success(`${check.label} 已修复`);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setActionLoading('');
    }
  }

  if (loading) {
    return <div className="state-placeholder"><CheckCircle size={32} /><span>加载诊断数据...</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  const s = data!.summary;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>一键向导</h2>
        <button className="btn" onClick={load} title="刷新诊断">
          <RefreshCw size={14} /> 刷新
        </button>
      </div>

      <p style={{ color: 'var(--paper-dim)', marginBottom: 16, fontSize: 14 }}>
        检查本地环境、API key、示例数据和常见启动问题。适合第一次启动或服务不对劲时用。
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
        <h3>诊断清单</h3>
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
              {check.fix && (
                <button className="btn btn-sm btn-primary" onClick={() => runFix(check)} disabled={actionLoading === check.id}>
                  {actionLoading === check.id ? '...' : '修复'}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>快捷操作</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {data!.quickActions.map((action) => (
            <button
              key={action.id}
              className="btn"
              onClick={() => runAction(action)}
              disabled={actionLoading === action.id}
            >
              {action.id === 'reload-config' ? <RefreshCw size={14} /> : action.id === 'test-all-llm' ? <TestTube2 size={14} /> : <Database size={14} />}
              {actionLoading === action.id ? '执行中...' : action.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ fontSize: 11, color: 'var(--paper-dim)', marginTop: 12 }}>
        诊断时间：{data!.ts}
      </div>
    </div>
  );
}
