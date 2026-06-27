import { useEffect, useMemo, useState } from 'react';
import { Circle, Gauge, Plus, RotateCcw, Save } from 'lucide-react';
import {
  AdminQuotaFreeLimitSchema,
  AdminQuotaGrantSchema,
  AdminQuotaResetUserSchema,
  AdminQuotaSetUserSchema,
  type AdminQuotaFreeLimit,
  type AdminQuotaGrant,
  type AdminQuotaResetUser,
  type AdminQuotaSetUser,
} from '@yelan/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { DataTable, type Column } from '../components/DataTable';
import { ReasonDialog } from '../components/ReasonDialog';
import { formatUserLabel, useUserNameMap } from '../hooks/useUserNameMap';

interface QuotaSnapshot {
  userId: string;
  date: string;
  freeUsed: number;
  freeLimit: number;
  bonusUsed: number;
  bonusLimit: number;
  remaining: number;
  userFreeLimitOverride: number | null;
}

interface QuotaOverview {
  freeLimitOverride: number | null;
  freeLimit: number;
  refresh: {
    mode: 'daily';
    date: string;
    timezone: string;
    nextRefreshAt: string;
  };
  totals?: {
    users: number;
    exhaustedUsers: number;
    remainingRounds: number;
  };
  quotas: QuotaSnapshot[];
}

type ReasonTarget = false | 'bonus' | 'freeLimit' | 'setUser' | 'resetUser';

export function Quota() {
  const { success, error: toastErr } = useToast();
  const userNames = useUserNameMap();
  const [data, setData] = useState<QuotaOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  const [bonusForm, setBonusForm] = useState({ userId: '', bonusDelta: 10 });
  const [freeLimitForm, setFreeLimitForm] = useState(20);
  const [userForm, setUserForm] = useState({ userId: '', freeLimit: '', bonusLimit: '' });
  const [resetUserId, setResetUserId] = useState('');
  const [reasonOpen, setReasonOpen] = useState<ReasonTarget>(false);

  const load = async () => {
    try {
      const result = await api.get<QuotaOverview>('/api/admin/quota');
      setData(result);
      setFreeLimitForm(result.freeLimitOverride ?? result.freeLimit);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载配额数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleBonusConfirm(reason: string) {
    try {
      const body: AdminQuotaGrant = AdminQuotaGrantSchema.parse({
        userId: bonusForm.userId.trim(),
        bonusDelta: Number(bonusForm.bonusDelta),
        reason,
      });
      await api.post('/api/admin/quota/grant', body);
      success(`已为 ${body.userId} 发放 ${body.bonusDelta} bonus`);
      setBonusForm({ userId: '', bonusDelta: 10 });
      setReasonOpen(false);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function handleFreeLimitConfirm(reason: string) {
    try {
      const body: AdminQuotaFreeLimit = AdminQuotaFreeLimitSchema.parse({
        freeLimit: Number(freeLimitForm),
        reason,
      });
      await api.post('/api/admin/quota/free-limit', body);
      success(`全局每日免费额度已设为 ${body.freeLimit}`);
      setReasonOpen(false);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function handleSetUserConfirm(reason: string) {
    try {
      const patch: Record<string, unknown> = {
        userId: userForm.userId.trim(),
        reason,
      };
      if (userForm.freeLimit.trim()) patch.freeLimit = Number(userForm.freeLimit);
      if (userForm.bonusLimit.trim()) patch.bonusLimit = Number(userForm.bonusLimit);
      const body: AdminQuotaSetUser = AdminQuotaSetUserSchema.parse(patch);
      await api.post('/api/admin/quota/set-user', body);
      success(`已更新 ${body.userId} 今日额度`);
      setUserForm({ userId: '', freeLimit: '', bonusLimit: '' });
      setReasonOpen(false);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function handleResetUserConfirm(reason: string) {
    try {
      const body: AdminQuotaResetUser = AdminQuotaResetUserSchema.parse({
        userId: resetUserId.trim(),
        reason,
      });
      await api.post('/api/admin/quota/reset-user', body);
      success(`已重置 ${body.userId} 今日已用次数`);
      setResetUserId('');
      setReasonOpen(false);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  const columns: Column<QuotaSnapshot>[] = useMemo(() => [
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
    {
      key: 'freeUsed',
      header: '免费已用',
      width: 100,
      render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {row.freeUsed}<span style={{ color: 'var(--paper-mute)' }}>/{row.freeLimit}</span>
        </span>
      ),
    },
    {
      key: 'bonusUsed',
      header: 'Bonus 已用',
      width: 100,
      render: (row) => (
        <span style={{ fontFamily: 'var(--font-mono)' }}>
          {row.bonusUsed}<span style={{ color: 'var(--paper-mute)' }}>/{row.bonusLimit}</span>
        </span>
      ),
    },
    {
      key: 'remaining',
      header: '剩余',
      width: 80,
      render: (row) => {
        const cls = row.remaining <= 0 ? 'badge-danger' : row.remaining <= 3 ? 'badge-warn' : 'badge-ok';
        return <span className={`badge ${cls}`}>{row.remaining}</span>;
      },
    },
    {
      key: 'override',
      header: '单用户覆盖',
      width: 110,
      render: (row) => row.userFreeLimitOverride == null ? <span style={{ color: 'var(--paper-mute)' }}>默认</span> : row.userFreeLimitOverride,
    },
    { key: 'date', header: '日期', mono: true, width: 110 },
    {
      key: 'actions',
      header: '操作',
      width: 90,
      render: (row) => (
        <button
          className="btn btn-sm"
          onClick={() => {
            setResetUserId(row.userId);
            setReasonOpen('resetUser');
          }}
        >
          <RotateCcw size={13} /> 重置
        </button>
      ),
    },
  ], [userNames]);

  if (loading) {
    return <div className="state-placeholder"><Gauge size={32} /><span>加载配额数据...</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  const quotas = data?.quotas ?? [];
  const freeLimit = data?.freeLimit ?? 20;
  const override = data?.freeLimitOverride;
  const totals = data?.totals;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>对话次数额度</h2>
        <span className="pill">每日刷新 · {data?.refresh.date} · {data?.refresh.timezone}</span>
      </div>

      <div className="metrics">
        <div className="metric">
          <div className="metric-label">默认每日免费额度</div>
          <div className="metric-value">{freeLimit}</div>
          <div className="metric-detail">{override == null ? '来自策略默认值' : `全局覆盖为 ${override}`}</div>
        </div>
        <div className="metric">
          <div className="metric-label">今日有记录用户</div>
          <div className="metric-value">{totals?.users ?? quotas.length}</div>
          <div className="metric-detail">产生对话或被运营设置后出现</div>
        </div>
        <div className="metric">
          <div className="metric-label">已耗尽用户</div>
          <div className="metric-value">{totals?.exhaustedUsers ?? 0}</div>
          <div className="metric-detail">剩余免费 + bonus 为 0</div>
        </div>
        <div className="metric">
          <div className="metric-label">下次刷新</div>
          <div className="metric-value" style={{ fontSize: 16 }}>{data?.refresh.nextRefreshAt.slice(11, 16)} UTC</div>
          <div className="metric-detail">当前 mock 期按 UTC 日期刷新</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
        <div className="card">
          <h3>发放 Bonus</h3>
          <div className="field">
            <label>用户 ID</label>
            <input
              value={bonusForm.userId}
              onChange={(e) => setBonusForm((prev) => ({ ...prev, userId: e.target.value }))}
              placeholder="usr_xxxxxxxx"
            />
          </div>
          <div className="field">
            <label>Bonus 轮次</label>
            <input
              type="number"
              value={bonusForm.bonusDelta}
              onChange={(e) => setBonusForm((prev) => ({ ...prev, bonusDelta: Number(e.target.value) }))}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setReasonOpen('bonus')}
            disabled={!bonusForm.userId.trim() || !bonusForm.bonusDelta}
          >
            <Plus size={14} /> 发放
          </button>
        </div>

        <div className="card">
          <h3>全局默认额度</h3>
          <div className="field">
            <label>每日免费轮次</label>
            <input
              type="number"
              min={0}
              max={500}
              value={freeLimitForm}
              onChange={(e) => setFreeLimitForm(Number(e.target.value))}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setReasonOpen('freeLimit')}
            disabled={freeLimitForm === freeLimit || freeLimitForm < 0 || freeLimitForm > 500}
          >
            <Save size={14} /> 应用
          </button>
        </div>

        <div className="card">
          <h3>单用户今日额度</h3>
          <div className="field">
            <label>用户 ID</label>
            <input
              value={userForm.userId}
              onChange={(e) => setUserForm((prev) => ({ ...prev, userId: e.target.value }))}
              placeholder="usr_xxxxxxxx"
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div className="field">
              <label>免费上限</label>
              <input
                type="number"
                value={userForm.freeLimit}
                onChange={(e) => setUserForm((prev) => ({ ...prev, freeLimit: e.target.value }))}
                placeholder="留空不改"
              />
            </div>
            <div className="field">
              <label>Bonus 上限</label>
              <input
                type="number"
                value={userForm.bonusLimit}
                onChange={(e) => setUserForm((prev) => ({ ...prev, bonusLimit: e.target.value }))}
                placeholder="留空不改"
              />
            </div>
          </div>
          <button
            className="btn btn-primary"
            onClick={() => setReasonOpen('setUser')}
            disabled={!userForm.userId.trim() || (!userForm.freeLimit.trim() && !userForm.bonusLimit.trim())}
          >
            <Save size={14} /> 设置
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        rows={quotas}
        emptyMessage="暂无今日配额数据。用户对话后会自动出现，也可以先用单用户设置创建今日记录。"
        rowKey={(row) => `${row.userId}-${row.date}`}
      />

      <ReasonDialog
        open={reasonOpen === 'bonus'}
        title="发放 Bonus 配额"
        message={`用户 ${bonusForm.userId} / +${bonusForm.bonusDelta} bonus 轮次`}
        confirmLabel="确认发放"
        onConfirm={handleBonusConfirm}
        onCancel={() => setReasonOpen(false)}
      />

      <ReasonDialog
        open={reasonOpen === 'freeLimit'}
        title="修改全局每日免费额度"
        message={`将每日免费轮次从 ${freeLimit} 改为 ${freeLimitForm}`}
        confirmLabel="确认修改"
        onConfirm={handleFreeLimitConfirm}
        onCancel={() => setReasonOpen(false)}
      />

      <ReasonDialog
        open={reasonOpen === 'setUser'}
        title="设置单用户今日额度"
        message={`用户 ${userForm.userId} / 免费上限 ${userForm.freeLimit || '不改'} / Bonus 上限 ${userForm.bonusLimit || '不改'}`}
        confirmLabel="确认设置"
        onConfirm={handleSetUserConfirm}
        onCancel={() => setReasonOpen(false)}
      />

      <ReasonDialog
        open={reasonOpen === 'resetUser'}
        title="重置今日已用次数"
        message={`用户 ${resetUserId} 的 freeUsed 和 bonusUsed 将归零，额度上限保留。`}
        confirmLabel="确认重置"
        onConfirm={handleResetUserConfirm}
        onCancel={() => setReasonOpen(false)}
      />
    </div>
  );
}
