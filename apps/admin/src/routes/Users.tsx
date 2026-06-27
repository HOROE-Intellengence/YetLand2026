import { useEffect, useMemo, useState } from 'react';
import { Users, Circle } from 'lucide-react';
import {
  AdminUsersFlagsSchema,
  DEFAULT_USER_BOUNDARY,
  type AdminUsersFlags,
} from '@yelan/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { DataTable, type Column } from '../components/DataTable';
import { ReasonDialog } from '../components/ReasonDialog';

interface AdminUser {
  id: string;
  name?: string;
  // phone 与 email 都可能空 —— email-auth phase 后，新用户可能只有 email、老用户可能只有 phone
  phone?: string;
  email?: string;
  ageVerified: boolean;
  narrativeBoundary: number;
  ifUnlocked: boolean;
  createdAt: string;
  candle: number;
  conversationRounds: number;
}

function maskPhone(phone?: string): string {
  if (!phone) return '—';
  if (phone.length <= 4) return phone;
  return phone.slice(0, 3) + '****' + phone.slice(-2);
}

// 邮箱在 admin 不做脱敏 —— 运营场景下需要完整邮箱以做对账 / 联系用户
// （如果未来需要脱敏：'foo@x.com' → 'f***@x.com'，再开新 helper）
function emailOrDash(email?: string): string {
  return email || '—';
}

function boundaryBadge(b: number): string {
  if (b >= 4) return 'badge-danger';
  if (b >= 3) return 'badge-warn';
  return 'badge-ok';
}

export function UsersPanel() {
  const { success, error: toastErr } = useToast();
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [flags, setFlags] = useState<Omit<AdminUsersFlags, 'reason'>>({ ifUnlocked: false, narrativeBoundary: DEFAULT_USER_BOUNDARY, ageVerified: false });
  const [reasonOpen, setReasonOpen] = useState(false);

  const load = async () => {
    try {
      const data = await api.get<AdminUser[]>('/api/admin/users?limit=200');
      setRows(data);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载用户列表失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function startEdit(u: AdminUser) {
    setEditing(u);
    setFlags({ ifUnlocked: u.ifUnlocked, narrativeBoundary: u.narrativeBoundary as AdminUsersFlags['narrativeBoundary'], ageVerified: u.ageVerified });
  }

  function cancelEdit() {
    setEditing(null);
    setReasonOpen(false);
  }

  async function handleSave(reason: string) {
    if (!editing) return;
    try {
      const body = AdminUsersFlagsSchema.parse({ ...flags, reason });
      await api.patch(`/api/admin/users/${encodeURIComponent(editing.id)}/flags`, body);
      success(`用户 ${editing.id} 已更新`);
      setEditing(null);
      setReasonOpen(false);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  const columns: Column<AdminUser>[] = useMemo(() => [
    {
      key: 'id', header: 'ID', mono: true, width: 140,
    },
    {
      key: 'name', header: '称呼', width: 120,
      render: (row) => row.name || '—',
    },
    {
      key: 'email', header: '邮箱', mono: true, width: 200,
      render: (row) => emailOrDash(row.email),
    },
    {
      key: 'phone', header: '手机', mono: true, width: 120,
      render: (row) => maskPhone(row.phone),
    },
    {
      key: 'narrativeBoundary', header: '边界', width: 60,
      render: (row) => <span className={`badge ${boundaryBadge(row.narrativeBoundary)}`}>B{row.narrativeBoundary}</span>,
    },
    {
      key: 'ifUnlocked', header: 'IF', width: 50,
      render: (row) => <span className={`badge ${row.ifUnlocked ? 'badge-ok' : 'badge-danger'}`}>{row.ifUnlocked ? '已' : '未'}</span>,
    },
    {
      key: 'ageVerified', header: '年龄', width: 50,
      render: (row) => <span className={`badge ${row.ageVerified ? 'badge-ok' : 'badge-warn'}`}>{row.ageVerified ? '已验证' : '未'}</span>,
    },
    {
      key: 'candle', header: '烛', width: 60,
      render: (row) => row.candle.toLocaleString(),
    },
    {
      key: 'conversationRounds', header: '对话轮数', width: 80,
      render: (row) => row.conversationRounds.toLocaleString(),
    },
    {
      key: 'createdAt', header: '注册时间', mono: true, width: 150,
      render: (row) => {
        try { return new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false }); }
        catch { return row.createdAt; }
      },
    },
    {
      key: '_actions', header: '操作', width: 70,
      render: (row) => (
        <button className="btn btn-sm" onClick={() => startEdit(row)}>编辑</button>
      ),
    },
  ], []);

  if (loading) {
    return <div className="state-placeholder"><Users size={32} /><span>加载用户列表...</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>用户管理</h2>
        <span className="pill">{rows.length} 个用户</span>
      </div>

      <DataTable
        columns={columns}
        rows={rows}
        emptyMessage="暂无用户数据。运行 pnpm seed 灌入示例数据。"
        rowKey={(row) => row.id}
      />

      {editing && (
        <div className="modal-overlay" onClick={cancelEdit}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 600 }}>
            <h2>编辑用户: {editing.id}</h2>

            <div className="metrics" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 16 }}>
              <div className="metric">
                <div className="metric-label">邮箱（登录标识）</div>
                <div className="metric-value" style={{ fontSize: 13, fontFamily: 'var(--font-mono)' }}>{emailOrDash(editing.email)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">手机</div>
                <div className="metric-value" style={{ fontSize: 14, fontFamily: 'var(--font-mono)' }}>{maskPhone(editing.phone)}</div>
              </div>
              <div className="metric">
                <div className="metric-label">烛余额</div>
                <div className="metric-value" style={{ fontSize: 14 }}>{editing.candle}</div>
              </div>
              <div className="metric">
                <div className="metric-label">注册时间</div>
                <div className="metric-value" style={{ fontSize: 14 }}>
                  {(() => { try { return new Date(editing.createdAt).toLocaleDateString('zh-CN'); } catch { return editing.createdAt; } })()}
                </div>
              </div>
            </div>

            <div className="field">
              <label>破甲边界 (1-5)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {([1, 2, 3, 4, 5] as const).map((n) => (
                  <button
                    key={n}
                    className={`btn btn-sm ${flags.narrativeBoundary === n ? 'btn-primary' : ''}`}
                    onClick={() => setFlags((prev) => ({ ...prev, narrativeBoundary: n }))}
                  >
                    B{n}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={flags.ifUnlocked}
                  onChange={(e) => setFlags((prev) => ({ ...prev, ifUnlocked: e.target.checked }))}
                  style={{ width: 'auto', margin: 0 }}
                />
                IF 暗号已解锁
              </label>
            </div>

            <div className="field">
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={flags.ageVerified}
                  onChange={(e) => setFlags((prev) => ({ ...prev, ageVerified: e.target.checked }))}
                  style={{ width: 'auto', margin: 0 }}
                />
                年龄已验证
              </label>
            </div>

            <div className="modal-actions">
              <button className="btn" onClick={cancelEdit}>取消</button>
              <button
                className="btn btn-primary"
                onClick={() => setReasonOpen(true)}
                disabled={flags.narrativeBoundary === editing.narrativeBoundary && flags.ifUnlocked === editing.ifUnlocked && flags.ageVerified === editing.ageVerified}
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      )}

      <ReasonDialog
        open={reasonOpen}
        title={`修改用户 ${editing?.id ?? ''}`}
        message={`B${editing?.narrativeBoundary ?? '-'}→B${flags.narrativeBoundary} / IF: ${editing?.ifUnlocked ? '已' : '未'}→${flags.ifUnlocked ? '已' : '未'} / 年龄: ${editing?.ageVerified ? '已验证' : '未'}→${flags.ageVerified ? '已验证' : '未'}`}
        onConfirm={handleSave}
        onCancel={() => setReasonOpen(false)}
      />
    </div>
  );
}
