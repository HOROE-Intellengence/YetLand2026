import { useEffect, useMemo, useState } from 'react';
import { CreditCard, Circle } from 'lucide-react';
import {
  AdminMembershipCancelSchema,
  AdminMembershipGrantSchema,
  AdminMembershipPlanPatchSchema,
  type AdminMembershipCancel,
  type AdminMembershipGrant,
  type AdminMembershipPlanPatch,
  type Plan,
  type Subscription,
} from '@yelan/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

type PlanDraft = {
  name: string;
  tagline: string;
  description: string;
  perksText: string;
  active: boolean;
  featured: boolean;
  sortOrder: string;
  weekPrice: string;
  weekListPrice: string;
  weekDiscount: string;
  weekCandle: string;
  weekEnabled: boolean;
  monthPrice: string;
  monthListPrice: string;
  monthDiscount: string;
  monthCandle: string;
  monthEnabled: boolean;
  reason: string;
};

interface MembershipPlansResponse { plans: Plan[] }
interface MembershipSubscriptionsResponse { subscriptions: Subscription[] }

function toDraft(plan: Plan): PlanDraft {
  return {
    name: plan.name,
    tagline: plan.tagline ?? '',
    description: plan.description ?? '',
    perksText: plan.perks.join('\n'),
    active: plan.active,
    featured: Boolean(plan.featured),
    sortOrder: String(plan.sortOrder),
    weekPrice: String(plan.cycleDetails.week.price),
    weekListPrice: plan.cycleDetails.week.listPrice === null ? '' : String(plan.cycleDetails.week.listPrice),
    weekDiscount: plan.cycleDetails.week.discountLabel,
    weekCandle: String(plan.cycleDetails.week.candleGrant),
    weekEnabled: plan.cycleDetails.week.enabled,
    monthPrice: String(plan.cycleDetails.month.price),
    monthListPrice: plan.cycleDetails.month.listPrice === null ? '' : String(plan.cycleDetails.month.listPrice),
    monthDiscount: plan.cycleDetails.month.discountLabel,
    monthCandle: String(plan.cycleDetails.month.candleGrant),
    monthEnabled: plan.cycleDetails.month.enabled,
    reason: '',
  };
}

function numberOrNull(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return Number(trimmed);
}

function numberValue(value: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error('数字格式不正确');
  return n;
}

function buildPatch(draft: PlanDraft): AdminMembershipPlanPatch {
  return AdminMembershipPlanPatchSchema.parse({
    name: draft.name,
    tagline: draft.tagline,
    description: draft.description,
    perks: draft.perksText.split('\n').map((v) => v.trim()).filter(Boolean),
    active: draft.active,
    featured: draft.featured,
    sortOrder: Math.round(numberValue(draft.sortOrder)),
    cycleDetails: {
      week: {
        price: numberValue(draft.weekPrice),
        listPrice: numberOrNull(draft.weekListPrice),
        discountLabel: draft.weekDiscount,
        candleGrant: Math.round(numberValue(draft.weekCandle)),
        enabled: draft.weekEnabled,
      },
      month: {
        price: numberValue(draft.monthPrice),
        listPrice: numberOrNull(draft.monthListPrice),
        discountLabel: draft.monthDiscount,
        candleGrant: Math.round(numberValue(draft.monthCandle)),
        enabled: draft.monthEnabled,
      },
    },
    reason: draft.reason,
  });
}

function formatPeriod(value?: string): string {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function Membership() {
  const { success, error: toastErr } = useToast();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [drafts, setDrafts] = useState<Record<string, PlanDraft>>({});
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [savingPlan, setSavingPlan] = useState('');
  const [grantUserId, setGrantUserId] = useState('');
  const [grantPlanId, setGrantPlanId] = useState<'moonlight' | 'milkyway' | 'eternal'>('moonlight');
  const [grantCycle, setGrantCycle] = useState<'week' | 'month'>('month');
  const [grantDays, setGrantDays] = useState('30');
  const [grantCandleOverride, setGrantCandleOverride] = useState('');
  const [grantReason, setGrantReason] = useState('');
  const [cancelUserId, setCancelUserId] = useState('');
  const [cancelReason, setCancelReason] = useState('');
  const [busyAction, setBusyAction] = useState('');

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const [planData, subData] = await Promise.all([
        api.get<MembershipPlansResponse>('/api/admin/membership/plans'),
        api.get<MembershipSubscriptionsResponse>('/api/admin/membership/subscriptions'),
      ]);
      setPlans(planData.plans);
      setDrafts(Object.fromEntries(planData.plans.map((plan) => [plan.id, toDraft(plan)])));
      setSubscriptions(subData.subscriptions);
    } catch (e) {
      const msg = (e as Error).message;
      setErr(msg);
      toastErr('加载会员配置失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const planOptions = useMemo(() => plans.map((plan) => ({ id: plan.id, name: plan.name })), [plans]);

  function setDraft(planId: string, patch: Partial<PlanDraft>) {
    setDrafts((current) => {
      const existing = current[planId];
      if (!existing) return current;
      return { ...current, [planId]: { ...existing, ...patch } };
    });
  }

  async function savePlan(planId: string) {
    const draft = drafts[planId];
    if (!draft) return;
    setSavingPlan(planId);
    try {
      const body = buildPatch(draft);
      await api.patch(`/api/admin/membership/plans/${planId}`, body);
      success('会员套餐已更新');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setSavingPlan('');
    }
  }

  async function grantMembership() {
    setBusyAction('grant');
    try {
      const body: AdminMembershipGrant = AdminMembershipGrantSchema.parse({
        userId: grantUserId,
        planId: grantPlanId,
        cycle: grantCycle,
        periodDays: grantDays ? Number(grantDays) : undefined,
        candleGrantOverride: grantCandleOverride ? Number(grantCandleOverride) : undefined,
        reason: grantReason,
      });
      await api.post('/api/admin/membership/grant', body);
      success('已为用户开通会员');
      setGrantReason('');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setBusyAction('');
    }
  }

  async function cancelMembership() {
    setBusyAction('cancel');
    try {
      const body: AdminMembershipCancel = AdminMembershipCancelSchema.parse({
        userId: cancelUserId,
        immediate: false,
        reason: cancelReason,
      });
      await api.post('/api/admin/membership/cancel', body);
      success('已设置到期不续');
      setCancelReason('');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setBusyAction('');
    }
  }

  if (loading) {
    return <div className="state-placeholder"><CreditCard size={32} /><span>加载会员配置…</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  return (
    <div>
      <h2>会员管理</h2>

      <div className="metrics">
        <div className="metric">
          <div className="metric-label">套餐数</div>
          <div className="metric-value">{plans.length}</div>
          <div className="metric-detail">月光 / 星河 / 永夜</div>
        </div>
        <div className="metric">
          <div className="metric-label">有效订阅</div>
          <div className="metric-value">{subscriptions.filter((s) => s.status === 'active').length}</div>
          <div className="metric-detail">mock 状态，供灰测验证</div>
        </div>
      </div>

      {plans.map((plan) => {
        const draft = drafts[plan.id];
        if (!draft) return null;
        return (
          <section className="card" key={plan.id}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
              <div>
                <h3>{plan.name}</h3>
                <p style={{ color: 'var(--paper-dim)', marginBottom: 16 }}>{plan.tagline}</p>
              </div>
              <span className={plan.active ? 'badge badge-ok' : 'badge badge-warn'}>{plan.active ? '启用' : '停用'}</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
              <div className="field">
                <label>名称</label>
                <input value={draft.name} onChange={(e) => setDraft(plan.id, { name: e.target.value })} />
              </div>
              <div className="field">
                <label>排序</label>
                <input value={draft.sortOrder} onChange={(e) => setDraft(plan.id, { sortOrder: e.target.value })} />
              </div>
              <div className="field">
                <label>状态</label>
                <select value={draft.active ? 'on' : 'off'} onChange={(e) => setDraft(plan.id, { active: e.target.value === 'on' })}>
                  <option value="on">启用</option>
                  <option value="off">停用</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label>一句话</label>
              <input value={draft.tagline} onChange={(e) => setDraft(plan.id, { tagline: e.target.value })} />
            </div>
            <div className="field">
              <label>描述</label>
              <textarea value={draft.description} onChange={(e) => setDraft(plan.id, { description: e.target.value })} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <div>
                <h3>一周</h3>
                <div className="field"><label>价格</label><input value={draft.weekPrice} onChange={(e) => setDraft(plan.id, { weekPrice: e.target.value })} /></div>
                <div className="field"><label>划线价</label><input value={draft.weekListPrice} onChange={(e) => setDraft(plan.id, { weekListPrice: e.target.value })} placeholder="可空" /></div>
                <div className="field"><label>折扣文案</label><input value={draft.weekDiscount} onChange={(e) => setDraft(plan.id, { weekDiscount: e.target.value })} /></div>
                <div className="field"><label>赠烛</label><input value={draft.weekCandle} onChange={(e) => setDraft(plan.id, { weekCandle: e.target.value })} /></div>
              </div>
              <div>
                <h3>一月</h3>
                <div className="field"><label>价格</label><input value={draft.monthPrice} onChange={(e) => setDraft(plan.id, { monthPrice: e.target.value })} /></div>
                <div className="field"><label>划线价</label><input value={draft.monthListPrice} onChange={(e) => setDraft(plan.id, { monthListPrice: e.target.value })} placeholder="可空" /></div>
                <div className="field"><label>折扣文案</label><input value={draft.monthDiscount} onChange={(e) => setDraft(plan.id, { monthDiscount: e.target.value })} /></div>
                <div className="field"><label>赠烛</label><input value={draft.monthCandle} onChange={(e) => setDraft(plan.id, { monthCandle: e.target.value })} /></div>
              </div>
            </div>

            <div className="field">
              <label>权益，每行一条</label>
              <textarea value={draft.perksText} onChange={(e) => setDraft(plan.id, { perksText: e.target.value })} />
            </div>
            <div className="field">
              <label>变更原因</label>
              <input value={draft.reason} onChange={(e) => setDraft(plan.id, { reason: e.target.value })} placeholder="例如：灰测阶段压低月光价格" />
            </div>
            <button className="btn btn-primary" onClick={() => savePlan(plan.id)} disabled={savingPlan === plan.id || !draft.reason}>
              {savingPlan === plan.id ? '保存中…' : '保存套餐'}
            </button>
          </section>
        );
      })}

      <section className="card">
        <h3>人工调整</h3>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }}>
          <div className="field">
            <label>用户 ID</label>
            <input value={grantUserId} onChange={(e) => setGrantUserId(e.target.value)} placeholder="usr_..." />
          </div>
          <div className="field">
            <label>套餐</label>
            <select value={grantPlanId} onChange={(e) => setGrantPlanId(e.target.value as 'moonlight' | 'milkyway' | 'eternal')}>
              {planOptions.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}
            </select>
          </div>
          <div className="field">
            <label>周期</label>
            <select value={grantCycle} onChange={(e) => setGrantCycle(e.target.value as 'week' | 'month')}>
              <option value="week">一周</option>
              <option value="month">一月</option>
            </select>
          </div>
          <div className="field">
            <label>天数</label>
            <input value={grantDays} onChange={(e) => setGrantDays(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          <div className="field">
            <label>赠烛覆盖</label>
            <input value={grantCandleOverride} onChange={(e) => setGrantCandleOverride(e.target.value)} placeholder="可空，默认套餐值" />
          </div>
          <div className="field">
            <label>原因</label>
            <input value={grantReason} onChange={(e) => setGrantReason(e.target.value)} placeholder="例如：KOC 灰测名单" />
          </div>
        </div>
        <button className="btn btn-primary" onClick={grantMembership} disabled={busyAction === 'grant' || !grantUserId || !grantReason}>
          {busyAction === 'grant' ? '开通中…' : '人工开通'}
        </button>
      </section>

      <section className="card">
        <h3>到期不续</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr auto', gap: 12, alignItems: 'end' }}>
          <div className="field">
            <label>用户 ID</label>
            <input value={cancelUserId} onChange={(e) => setCancelUserId(e.target.value)} placeholder="usr_..." />
          </div>
          <div className="field">
            <label>原因</label>
            <input value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} placeholder="例如：退款/用户要求取消" />
          </div>
          <button className="btn btn-danger" onClick={cancelMembership} disabled={busyAction === 'cancel' || !cancelUserId || !cancelReason}>
            {busyAction === 'cancel' ? '处理中…' : '取消续期'}
          </button>
        </div>
      </section>

      <section className="card">
        <h3>最近订阅</h3>
        {subscriptions.length === 0 ? (
          <div className="state-placeholder"><CreditCard size={24} /><span>暂无订阅记录</span></div>
        ) : (
          <table>
            <thead>
              <tr><th>用户</th><th>套餐</th><th>周期</th><th>状态</th><th>到期</th><th>来源</th></tr>
            </thead>
            <tbody>
              {subscriptions.map((sub) => (
                <tr key={sub.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{sub.userId}</td>
                  <td>{sub.plan}</td>
                  <td>{sub.cycle === 'week' ? '一周' : '一月'}</td>
                  <td><span className={sub.status === 'active' ? 'badge badge-ok' : 'badge badge-warn'}>{sub.status}</span></td>
                  <td>{formatPeriod(sub.currentPeriodEnd)}</td>
                  <td>{sub.provider ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
