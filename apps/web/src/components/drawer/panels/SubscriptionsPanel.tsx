// 续夜 — 套餐与订阅
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Plan, SubscriptionCycle } from '@yelan/shared';
import { getMySubscription, listPlans, subscribe } from '../../../api/billing';
import s from './panel.module.css';

function formatPrice(value: number): string {
  return `¥${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}`;
}

function cycleLabel(cycle: SubscriptionCycle): string {
  return cycle === 'week' ? '一周' : '一月';
}

function PlanCard({
  plan,
  cycle,
  pending,
  onSubscribe,
}: {
  plan: Plan;
  cycle: SubscriptionCycle;
  pending: boolean;
  onSubscribe: (planId: Plan['id']) => void;
}) {
  const details = plan.cycleDetails[cycle];
  return (
    <article className={`${s.nightPlan}${plan.featured ? ` ${s.nightPlanFeatured}` : ''}`}>
      <div className={s.nightPlanHeader}>
        <div>
          <h3 className={s.nightPlanName}>{plan.name}</h3>
          <p className={s.nightTagline}>{plan.tagline}</p>
        </div>
        <div className={s.nightPrice}>
          {details.listPrice !== null && <span>{formatPrice(details.listPrice)}</span>}
          <strong>{formatPrice(details.price)}</strong>
          <em>/ {cycle === 'week' ? 'WEEK' : 'MONTH'}</em>
        </div>
      </div>

      <p className={s.nightDesc}>{plan.description}</p>
      <div className={s.tagRow}>
        {details.discountLabel && <span className={s.tag}>{details.discountLabel}</span>}
        <span className={s.tag}>赠 {details.candleGrant} 烛</span>
      </div>
      <ul className={s.nightPerks}>
        {plan.perks.map((perk) => <li key={perk}>{perk}</li>)}
      </ul>

      <button
        className={s.nightButton}
        onClick={() => onSubscribe(plan.id)}
        disabled={pending || !details.enabled || !plan.active}
      >
        {pending ? '夜色正在续上…' : '让夜再亮一程'}
      </button>
    </article>
  );
}

export function SubscriptionsPanel() {
  const [cycle, setCycle] = useState<SubscriptionCycle>('month');
  const [message, setMessage] = useState('');
  const queryClient = useQueryClient();
  const plansQuery = useQuery({ queryKey: ['billing', 'plans'], queryFn: listPlans });
  const subQuery = useQuery({ queryKey: ['billing', 'subscription'], queryFn: getMySubscription });
  const subscribeMutation = useMutation({
    mutationFn: (planId: Plan['id']) => subscribe(planId, cycle),
    onSuccess: async () => {
      setMessage('夜又往后延了一寸。');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['billing', 'subscription'] }),
        queryClient.invalidateQueries({ queryKey: ['billing', 'candle'] }),
        queryClient.invalidateQueries({ queryKey: ['billing', 'candle-ledger'] }),
        // 开通会员后「今日额度」要立刻翻成「会员·不限」，否则用户以为充值没生效。
        queryClient.invalidateQueries({ queryKey: ['billing', 'quota'] }),
      ]);
    },
    onError: (e) => {
      setMessage((e as Error).message || '续夜暂时没有成功。');
    },
  });

  const plans = plansQuery.data ?? [];
  const subscription = subQuery.data;

  return (
    <div className={`${s.panel} ${s.nightPanel}`}>
      <div>
        <p className={s.mute}>01 / 续夜</p>
        <h2 className={s.title}>夜未央</h2>
        <p className={s.dim}>不是充值，是续住。你买的不是算力，是一段不会被免费叙事弧打断的夜晚。</p>
      </div>

      {subscription && (
        <div className={s.nightStatus}>
          <span>今夜仍亮着</span>
          <strong>{subscription.plan} · {cycleLabel(subscription.cycle)}</strong>
          <em>到 {new Date(subscription.currentPeriodEnd).toLocaleDateString('zh-CN')}</em>
        </div>
      )}

      <div className={s.nightCycle} aria-label="选择周期">
        {(['week', 'month'] as SubscriptionCycle[]).map((value) => (
          <button
            key={value}
            className={cycle === value ? s.nightCycleActive : ''}
            onClick={() => setCycle(value)}
          >
            {cycleLabel(value)}
          </button>
        ))}
      </div>

      {plansQuery.isLoading ? (
        <div className={s.placeholder}><p>正在点灯…</p></div>
      ) : plansQuery.isError ? (
        <div className={s.placeholder}><p>续夜页暂时打不开。</p></div>
      ) : (
        <div className={s.nightPlanList}>
          {plans.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              cycle={cycle}
              pending={subscribeMutation.isPending}
              onSubscribe={(planId) => subscribeMutation.mutate(planId)}
            />
          ))}
        </div>
      )}

      {message && <p className={subscribeMutation.isError ? s.error : s.success}>{message}</p>}
      <p className={s.nightFinePrint}>
        灰测版使用模拟支付：按下后直接写入本地会员与烛账。真实支付接入后，这里会等待支付网关回调确认。
      </p>
    </div>
  );
}
