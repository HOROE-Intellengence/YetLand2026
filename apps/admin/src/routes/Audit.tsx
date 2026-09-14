import { useEffect, useState, useMemo, useCallback } from 'react';
import { FileText, RefreshCw, Eye, Circle, ChevronLeft, ChevronRight } from 'lucide-react';
import { AdminAuditEntrySchema, type AdminAuditEntry } from '@yelan/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { DataTable, type Column } from '../components/DataTable';
import { JsonViewer } from '../components/JsonViewer';
import { formatDateTime } from '../lib/datetime';

const ACTION_GROUPS: { label: string; prefix: string }[] = [
  { label: '全部', prefix: '' },
  { label: '角色卡', prefix: 'character' },
  { label: '策略', prefix: 'policy' },
  { label: '配置', prefix: 'config' },
  { label: '烛账', prefix: 'candle' },
  { label: '配额', prefix: 'quota' },
  { label: '用户', prefix: 'user' },
  { label: 'IF 暗号', prefix: 'if-code' },
  { label: '问卷', prefix: 'survey' },
  { label: 'Prompt', prefix: 'prompt' },
  { label: '前置提示卡', prefix: 'prelude-card' },
  { label: '侧袋 Prompt', prefix: 'sidecar-prompts' },
  { label: 'LLM API', prefix: 'llm-api' },
  { label: 'Seed', prefix: 'seed' },
];

const formatTime = formatDateTime;

function actionBadgeClass(action: string): string {
  if (action.includes('delete') || action.includes('disable')) return 'badge-danger';
  if (action.includes('create') || action.includes('enable') || action.includes('grant')) return 'badge-ok';
  if (action.includes('update') || action.includes('patch') || action.includes('toggle')) return 'badge-warn';
  return 'badge';
}

export function Audit() {
  const { error: toastErr } = useToast();
  const [rows, setRows] = useState<AdminAuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<AdminAuditEntry | null>(null);
  const PAGE_SIZE = 50;

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(page * PAGE_SIZE) });
      if (filter) params.set('action', filter);
      const data = await api.get<{ rows: AdminAuditEntry[]; total: number }>(`/api/admin/audit?${params}`);
      const parsed = data.rows.map((entry) => AdminAuditEntrySchema.parse(entry));
      setRows(parsed);
      setTotal(data.total);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载审计日志失败');
    } finally {
      setLoading(false);
    }
  }, [filter, page]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const columns: Column<AdminAuditEntry>[] = useMemo(() => [
    {
      key: 'ts', header: '时间', mono: true, width: 160,
      render: (row) => formatTime(row.ts),
    },
    {
      key: 'action', header: '动作', width: 200,
      render: (row) => <span className={actionBadgeClass(row.action)}>{row.action}</span>,
    },
    {
      key: 'target', header: '目标', mono: true, width: 160,
      render: (row) => row.target || '-',
    },
    {
      key: 'reason', header: '原因',
      render: (row) => (
        <span style={{ maxWidth: 320, display: 'inline-block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.reason || '-'}
        </span>
      ),
    },
    {
      key: 'payload', header: '明细', width: 70,
      render: (row) =>
        row.payload != null ? (
          <button className="btn btn-sm" onClick={() => setSelected(row)} title="查看 payload">
            <Eye size={12} />
          </button>
        ) : null,
    },
  ], []);

  if (loading) {
    return <div className="state-placeholder"><FileText size={32} /><span>加载审计日志...</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>审计日志</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={filter} onChange={(e) => { setFilter(e.target.value); setPage(0); }}>
            {ACTION_GROUPS.map((g) => (
              <option key={g.prefix} value={g.prefix}>{g.label}</option>
            ))}
          </select>
          <button className="btn" onClick={load} title="刷新">
            <RefreshCw size={14} /> 刷新
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        emptyMessage="暂无审计记录。执行写操作后，记录会出现在这里。"
        rowKey={(row) => row.id}
      />

      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <button className="btn btn-sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            <ChevronLeft size={14} />
          </button>
          <span style={{ fontSize: 13, color: 'var(--paper-dim)' }}>
            第 {page + 1}/{Math.ceil(total / PAGE_SIZE)} 页 · 共 {total} 条
          </span>
          <button className="btn btn-sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((p) => p + 1)}>
            <ChevronRight size={14} />
          </button>
        </div>
      )}

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 700, width: '65vw' }}>
            <h2>审计明细</h2>
            <div className="metrics" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 16 }}>
              <div className="metric">
                <div className="metric-label">动作</div>
                <div className="metric-value" style={{ fontSize: 14 }}>{selected.action}</div>
              </div>
              <div className="metric">
                <div className="metric-label">目标</div>
                <div className="metric-value" style={{ fontSize: 14, fontFamily: 'var(--font-mono)' }}>{selected.target || '-'}</div>
              </div>
              <div className="metric">
                <div className="metric-label">时间</div>
                <div className="metric-value" style={{ fontSize: 14 }}>{formatTime(selected.ts)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">操作人</div>
                <div className="metric-value" style={{ fontSize: 14 }}>{selected.actor}</div>
              </div>
            </div>
            {selected.reason && (
              <div className="field">
                <label>变更原因</label>
                <div style={{ color: 'var(--paper-dim)', fontSize: 14 }}>{selected.reason}</div>
              </div>
            )}
            {selected.payload != null && (
              <div className="field">
                <label>Payload</label>
                <JsonViewer data={selected.payload} />
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setSelected(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
