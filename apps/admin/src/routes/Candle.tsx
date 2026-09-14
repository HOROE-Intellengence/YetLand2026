import { useEffect, useMemo, useState, useCallback } from 'react';
import { Flame, Circle, Plus } from 'lucide-react';
import { AdminCandleGrantSchema, type AdminCandleGrant } from '@yelan/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { DataTable, type Column } from '../components/DataTable';
import { ReasonDialog } from '../components/ReasonDialog';
import { formatUserLabel, useUserNameMap } from '../hooks/useUserNameMap';
import { formatDateTime } from '../lib/datetime';

interface CandleLedgerRow {
  id: string;
  userId: string;
  delta: number;
  reason: string;
  refId?: string;
  createdAt: string;
}

export function Candle() {
  const { success, error: toastErr } = useToast();
  const userNames = useUserNameMap();
  const [rows, setRows] = useState<CandleLedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [grantForm, setGrantForm] = useState({ userId: '', delta: 50, reason: '' });
  const [reasonOpen, setReasonOpen] = useState(false);
  const [pendingGrant, setPendingGrant] = useState<AdminCandleGrant | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (userIdFilter.trim()) params.set('userId', userIdFilter.trim());
      const data = await api.get<CandleLedgerRow[]>(`/api/admin/candle/ledger?${params}`);
      setRows(data);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载烛账流水失败');
    } finally {
      setLoading(false);
    }
  }, [userIdFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  function handleGrantClick() {
    if (!grantForm.userId.trim() || !grantForm.delta) return;
    setPendingGrant({
      userId: grantForm.userId.trim(),
      delta: Number(grantForm.delta),
      reason: '', // filled by ReasonDialog
    });
    setReasonOpen(true);
  }

  async function handleGrantConfirm(reason: string) {
    if (!pendingGrant) return;
    try {
      const body = AdminCandleGrantSchema.parse({ ...pendingGrant, reason });
      await api.post('/api/admin/candle/grant', body);
      success(`已为 ${body.userId} ${body.delta >= 0 ? '发放' : '扣除'} ${Math.abs(body.delta)} 烛`);
      setGrantForm({ userId: '', delta: 50, reason: '' });
      setPendingGrant(null);
      setReasonOpen(false);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  const balance = useMemo(() => rows.reduce((sum, r) => sum + r.delta, 0), [rows]);

  const columns: Column<CandleLedgerRow>[] = useMemo(() => [
    {
      key: 'createdAt', header: '时间', mono: true, width: 160,
      render: (row) => formatDateTime(row.createdAt),
    },
    {
      key: 'id', header: '流水号', mono: true, width: 120,
    },
    {
      key: 'userId', header: '用户', width: 150,
      render: (row) => (
        <span style={{ whiteSpace: 'pre-wrap', fontFamily: userNames[row.userId] ? undefined : 'var(--font-mono)' }}>
          {formatUserLabel(row.userId, userNames)}
        </span>
      ),
    },
    {
      key: 'delta', header: '变动', width: 80,
      render: (row) => (
        <span style={{ color: row.delta >= 0 ? 'var(--ok)' : 'var(--danger)', fontFamily: 'var(--font-mono)', fontWeight: 500 }}>
          {row.delta >= 0 ? '+' : ''}{row.delta}
        </span>
      ),
    },
    {
      key: 'reason', header: '原因',
      render: (row) => (
        <span style={{ maxWidth: 240, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.reason}
        </span>
      ),
    },
    {
      key: 'refId', header: '关联', mono: true, width: 130,
      render: (row) => row.refId || '-',
    },
  ], [userNames]);

  if (loading) {
    return <div className="state-placeholder"><Flame size={32} /><span>加载烛账流水...</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>烛账</h2>
        <span className="pill">{rows.length} 条流水</span>
      </div>

      <div className="card">
        <h3>发烛 / 扣烛</h3>
        <div className="metrics" style={{ gridTemplateColumns: '1fr 100px 1fr', alignItems: 'end', marginBottom: 0 }}>
          <div className="field">
            <label>用户 ID</label>
            <input
              value={grantForm.userId}
              onChange={(e) => setGrantForm((prev) => ({ ...prev, userId: e.target.value }))}
              placeholder="usr_xxxxxxxx"
            />
          </div>
          <div className="field">
            <label>数量</label>
            <input
              type="number"
              value={grantForm.delta}
              onChange={(e) => setGrantForm((prev) => ({ ...prev, delta: Number(e.target.value) }))}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={handleGrantClick}
            disabled={!grantForm.userId.trim() || !grantForm.delta}
            style={{ height: 38 }}
          >
            <Plus size={14} /> 执行
          </button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--paper-dim)', marginTop: -8 }}>
          正数=发放，负数=扣除。所有操作均记录审计日志。
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div className="field" style={{ marginBottom: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>用户筛选</label>
          <input
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            placeholder="留空=全部"
            style={{ width: 180 }}
          />
        </div>
        <div style={{ fontSize: 14, color: 'var(--gold-light)', fontFamily: 'var(--font-mono)' }}>
          净变动 {balance >= 0 ? '+' : ''}{balance}
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        emptyMessage="暂无烛账流水。执行发烛或用户注册后会出现记录。"
        rowKey={(row) => row.id}
      />

      <ReasonDialog
        open={reasonOpen}
        title="确认发烛"
        message={
          pendingGrant
            ? `用户 ${pendingGrant.userId} / ${pendingGrant.delta >= 0 ? '+' : ''}${pendingGrant.delta} 烛`
            : ''
        }
        confirmLabel={pendingGrant && pendingGrant.delta >= 0 ? '确认发放' : '确认扣除'}
        onConfirm={handleGrantConfirm}
        onCancel={() => { setReasonOpen(false); setPendingGrant(null); }}
      />
    </div>
  );
}
