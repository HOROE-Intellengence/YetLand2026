import { useEffect, useState } from 'react';
import { Activity, Circle } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

interface HealthData {
  server?: { mode?: string };
  counts?: { users?: number; sessions?: number; messages?: number };
}
interface CostRow { date: string; cost: number; tokens: number; calls: number }

export function Overview() {
  const { error: toastError } = useToast();
  const [health, setHealth] = useState<HealthData | null>(null);
  const [diag, setDiag] = useState<HealthData['counts'] | null>(null);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [h, c] = await Promise.all([
          api.get<HealthData>('/api/admin/health').catch(() => null),
          api.get<CostRow[]>('/api/admin/costs').catch(() => []),
        ]);
        if (cancelled) return;
        setHealth(h);
        setDiag(h?.counts ?? null);
        setCosts(Array.isArray(c) ? c : []);
      } catch (e) {
        if (cancelled) return;
        setErr((e as Error).message);
        toastError('加载总览数据失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="state-placeholder">
        <Activity size={32} />
        <span>加载中…</span>
      </div>
    );
  }

  if (err) {
    return (
      <div className="state-placeholder state-error">
        <Circle size={32} />
        <span>{err}</span>
      </div>
    );
  }

  const totalCost = costs.reduce((s, r) => s + (r.cost ?? 0), 0);
  const totalTokens = costs.reduce((s, r) => s + (r.tokens ?? 0), 0);
  const totalCalls = costs.reduce((s, r) => s + (r.calls ?? 0), 0);

  return (
    <div>
      <h2>总览</h2>

      <div className="metrics">
        <div className="metric">
          <div className="metric-label">用户</div>
          <div className="metric-value">{diag?.users ?? '—'}</div>
        </div>
        <div className="metric">
          <div className="metric-label">会话</div>
          <div className="metric-value">{diag?.sessions ?? '—'}</div>
        </div>
        <div className="metric">
          <div className="metric-label">消息</div>
          <div className="metric-value">{diag?.messages ?? '—'}</div>
        </div>
        <div className="metric">
          <div className="metric-label">模式</div>
          <div className="metric-value" style={{ fontSize: 18 }}>{health?.server?.mode ?? '—'}</div>
        </div>
      </div>

      <div className="card">
        <h3>成本概览（累计）</h3>
        <div className="metrics" style={{ marginTop: 12 }}>
          <div className="metric">
            <div className="metric-label">总调用</div>
            <div className="metric-value">{totalCalls.toLocaleString()}</div>
          </div>
          <div className="metric">
            <div className="metric-label">总 Token</div>
            <div className="metric-value">{totalTokens.toLocaleString()}</div>
          </div>
          <div className="metric">
            <div className="metric-label">预估成本</div>
            <div className="metric-value">${totalCost.toFixed(4)}</div>
          </div>
        </div>
      </div>

      {costs.length > 0 && (
        <div className="card">
          <h3>每日成本</h3>
          <table>
            <thead>
              <tr><th>日期</th><th>调用</th><th>Token</th><th>成本</th></tr>
            </thead>
            <tbody>
              {costs.slice(0, 30).map((r) => (
                <tr key={r.date}>
                  <td>{r.date}</td>
                  <td>{r.calls?.toLocaleString() ?? 0}</td>
                  <td>{r.tokens?.toLocaleString() ?? 0}</td>
                  <td style={{ fontFamily: 'var(--font-mono)' }}>${(r.cost ?? 0).toFixed(6)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
