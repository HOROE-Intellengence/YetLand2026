import { useEffect, useState, useMemo } from 'react';
import { DollarSign, Circle } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { DataTable, type Column } from '../components/DataTable';
import { formatUserLabel, useUserNameMap } from '../hooks/useUserNameMap';

interface CostDaily {
  date: string;
  cost: number;
  tokens: number;
  calls: number;
}

interface PerUser {
  userId: string;
  calls: number;
  tokens: number;
}

export function Costs() {
  const { error: toastErr } = useToast();
  const userNames = useUserNameMap();
  const [daily, setDaily] = useState<CostDaily[]>([]);
  const [perUser, setPerUser] = useState<PerUser[]>([]);
  const [cacheRate, setCacheRate] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const load = async () => {
    try {
      const [d, pu, ch] = await Promise.all([
        api.get<CostDaily[]>('/api/admin/costs/daily'),
        api.get<PerUser[]>('/api/admin/costs/per-user'),
        api.get<{ rate: number }>('/api/admin/costs/cache-hit'),
      ]);
      setDaily(d);
      setPerUser(pu);
      setCacheRate(ch.rate);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载成本数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const todayTotal = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return daily.find((d) => d.date === today) ?? { date: today, cost: 0, tokens: 0, calls: 0 };
  }, [daily]);

  const summary = useMemo(() => {
    let totalCost = 0;
    let totalTokens = 0;
    let totalCalls = 0;
    for (const d of daily) {
      totalCost += d.cost;
      totalTokens += d.tokens;
      totalCalls += d.calls;
    }
    return { totalCost, totalTokens, totalCalls };
  }, [daily]);

  const dailyColumns: Column<CostDaily>[] = useMemo(() => [
    { key: 'date', header: '日期', mono: true, width: 120 },
    {
      key: 'calls', header: '调用次数', width: 100,
      render: (row) => row.calls.toLocaleString(),
    },
    {
      key: 'tokens', header: 'Tokens', width: 110,
      render: (row) => row.tokens.toLocaleString(),
    },
    {
      key: 'cost', header: '成本 (USD)', width: 120,
      render: (row) => `$${row.cost.toFixed(6)}`,
    },
  ], []);

  const userColumns: Column<PerUser>[] = useMemo(() => [
    {
      key: 'userId',
      header: '用户',
      width: 150,
      render: (row) => (
        <span style={{ whiteSpace: 'pre-wrap', fontFamily: userNames[row.userId] ? undefined : 'var(--font-mono)' }}>
          {formatUserLabel(row.userId, userNames)}
        </span>
      ),
    },
    { key: 'calls', header: '调用次数', width: 100 },
    { key: 'tokens', header: 'Tokens', width: 110 },
  ], [userNames]);

  if (loading) {
    return <div className="state-placeholder"><DollarSign size={32} /><span>加载成本数据...</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>成本统计</h2>

      <div className="metrics" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: 20 }}>
        <div className="metric">
          <div className="metric-label">今日调用</div>
          <div className="metric-value">{todayTotal.calls.toLocaleString()}</div>
        </div>
        <div className="metric">
          <div className="metric-label">今日 Tokens</div>
          <div className="metric-value">{todayTotal.tokens.toLocaleString()}</div>
        </div>
        <div className="metric">
          <div className="metric-label">今日成本</div>
          <div className="metric-value">${todayTotal.cost.toFixed(4)}</div>
        </div>
        <div className="metric">
          <div className="metric-label">缓存命中率</div>
          <div className="metric-value">{cacheRate != null ? `${(cacheRate * 100).toFixed(0)}%` : '-'}</div>
        </div>
      </div>

      <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 20 }}>
        <div className="metric">
          <div className="metric-label">累计调用</div>
          <div className="metric-value">{summary.totalCalls.toLocaleString()}</div>
        </div>
        <div className="metric">
          <div className="metric-label">累计 Tokens</div>
          <div className="metric-value">{summary.totalTokens.toLocaleString()}</div>
        </div>
        <div className="metric">
          <div className="metric-label">累计成本</div>
          <div className="metric-value">${summary.totalCost.toFixed(4)}</div>
        </div>
      </div>

      <div className="card">
        <h3>每日明细</h3>
        <DataTable
          columns={dailyColumns}
          rows={daily}
          emptyMessage="暂无成本记录。启动对话后，每日汇总会出现在这里。"
          rowKey={(row) => row.date}
        />
      </div>

      <div className="card">
        <h3>按用户</h3>
        <DataTable
          columns={userColumns}
          rows={perUser}
          emptyMessage="暂无用户调用记录。"
          rowKey={(row) => row.userId}
        />
      </div>
    </div>
  );
}
