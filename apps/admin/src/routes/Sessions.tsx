import { useEffect, useState, useMemo } from 'react';
import { MessageSquare, Circle, Eye } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { DataTable, type Column } from '../components/DataTable';
import { formatUserLabel, useUserNameMap } from '../hooks/useUserNameMap';

interface SessionRow {
  id: string;
  userId: string;
  characterId: string;
  mode: 'main' | 'if';
  ifActive?: boolean;
  round: number;
  prevStage: string;
  updatedAt: string;
  createdAt: string;
}

interface MessageRow {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}

const MODE_LABEL: Record<string, string> = { main: '主线', if: 'IF' };

function formatTime(ts: string) {
  try { return new Date(ts).toLocaleString('zh-CN', { hour12: false }); }
  catch { return ts; }
}

export function Sessions() {
  const { error: toastErr } = useToast();
  const userNames = useUserNameMap();
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [userIdFilter, setUserIdFilter] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [msgsLoading, setMsgsLoading] = useState(false);
  // 折叠无效对话：轮次 <= 1（刚开场、还没真正聊起来）默认隐藏
  const [foldInactive, setFoldInactive] = useState(true);

  const load = async () => {
    try {
      const params = new URLSearchParams();
      if (userIdFilter.trim()) params.set('userId', userIdFilter.trim());
      const data = await api.get<SessionRow[]>(`/api/admin/sessions?${params}`);
      setRows(data);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载会话列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function openMessages(id: string) {
    setSelectedId(id);
    setMsgsLoading(true);
    try {
      const data = await api.get<MessageRow[]>(`/api/admin/sessions/${encodeURIComponent(id)}/messages`);
      setMessages(data);
    } catch {
      setMessages([]);
    } finally {
      setMsgsLoading(false);
    }
  }

  const columns: Column<SessionRow>[] = useMemo(() => [
    {
      key: 'updatedAt', header: '最近更新', mono: true, width: 160,
      render: (row) => formatTime(row.updatedAt),
    },
    {
      key: 'id', header: '会话 ID', mono: true, width: 140,
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
      key: 'characterId', header: '角色卡', mono: true, width: 130,
    },
    {
      key: 'mode', header: '模式', width: 60,
      render: (row) => (
        <span className={`badge ${row.mode === 'if' ? 'badge-warn' : 'badge-ok'}`}>
          {MODE_LABEL[row.mode] ?? row.mode}
        </span>
      ),
    },
    {
      key: 'round', header: '轮次', width: 60,
    },
    {
      key: 'prevStage', header: '当前阶段', width: 90,
      render: (row) => row.prevStage,
    },
    {
      key: '_msgs', header: '消息', width: 70,
      render: (row) => (
        <button className="btn btn-sm" onClick={() => openMessages(row.id)}>
          <Eye size={12} /> 查看
        </button>
      ),
    },
  ], [userNames]);

  // 无效对话 = 轮次 <= 1（还没聊起来的空开场）
  const hiddenCount = useMemo(() => rows.filter((s) => s.round <= 1).length, [rows]);
  const visibleRows = useMemo(
    () => (foldInactive ? rows.filter((s) => s.round > 1) : rows),
    [rows, foldInactive],
  );

  if (loading) {
    return <div className="state-placeholder"><MessageSquare size={32} /><span>加载会话列表...</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>会话</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--paper-dim)', cursor: hiddenCount ? 'pointer' : 'default' }}>
            <input
              type="checkbox"
              checked={foldInactive}
              onChange={(e) => setFoldInactive(e.target.checked)}
              style={{ width: 'auto', margin: 0 }}
            />
            折叠无效对话{hiddenCount ? `（${hiddenCount}）` : ''}
          </label>
          <input
            value={userIdFilter}
            onChange={(e) => setUserIdFilter(e.target.value)}
            placeholder="用户 ID 筛选..."
            style={{ width: 180 }}
          />
          <button className="btn" onClick={load}>筛选</button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={visibleRows}
        emptyMessage="暂无会话记录。"
        rowKey={(row) => row.id}
      />

      {selectedId && (
        <div className="modal-overlay" onClick={() => setSelectedId(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 800, width: '70vw', maxHeight: '80vh', overflow: 'auto' }}>
            <h2>消息记录 — {selectedId}</h2>
            {msgsLoading ? (
              <div className="state-placeholder"><span>加载中...</span></div>
            ) : messages.length === 0 ? (
              <div className="state-placeholder"><span>暂无消息</span></div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: m.role === 'user' ? 'var(--surface-alt)' : 'var(--surface)',
                      borderLeft: `3px solid ${m.role === 'user' ? 'var(--accent)' : 'var(--gold-light)'}`,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 11, color: 'var(--paper-dim)' }}>
                      <span style={{ fontWeight: 500, textTransform: 'uppercase' }}>{m.role}</span>
                      <span>{formatTime(m.createdAt)}</span>
                    </div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-actions">
              <button className="btn" onClick={() => setSelectedId(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
