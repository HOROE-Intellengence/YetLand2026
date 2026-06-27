// 烛账 — 代币余额 + 账本 + 光态可视化
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getCandleBalance, getCandleLedger, getQuota } from '../../../api/billing';
import { useCandleStore } from '../../../stores/candleStore';
import { useQuotaStore } from '../../../stores/quotaStore';
import s from './panel.module.css';

const reasonLabel: Record<string, string> = {
  register_grant: '初始赠烛',
  favor_trigger: '心动触发',
  passion_trigger: '高光触发',
  daily_greeting: '每日问候',
  achievement: '成就奖励',
  survey: '一问奖励',
  subscription_grant: '续夜赠烛',
  admin_grant: '运营调整',
  unlock_card: '角色解锁',
  image_gen: '图像生成',
  exchange_quota: '兑换额度',
  expire: '过期',
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function CandleLedgerPanel() {
  const balanceQuery = useQuery({ queryKey: ['billing', 'candle'], queryFn: getCandleBalance });
  const ledgerQuery = useQuery({ queryKey: ['billing', 'candle-ledger'], queryFn: () => getCandleLedger({ limit: 20 }) });
  const quotaQuery = useQuery({ queryKey: ['billing', 'quota'], queryFn: getQuota });
  const setBalance = useCandleStore((state) => state.setBalance);
  const setQuota = useQuotaStore((state) => state.setFromServer);

  useEffect(() => {
    if (balanceQuery.data) {
      setBalance(balanceQuery.data.balance, balanceQuery.data.registerGrant);
    }
  }, [balanceQuery.data, setBalance]);

  useEffect(() => {
    if (quotaQuery.data) {
      setQuota(quotaQuery.data);
    }
  }, [quotaQuery.data, setQuota]);

  const quota = quotaQuery.data;
  const isMember = Boolean(quota?.membership);
  const used = quota ? quota.freeUsed + quota.bonusUsed : 0;
  const total = quota ? quota.freeLimit + quota.bonusLimit : 0;
  // 会员绕过闸门，有限分母无意义 → 进度条满格、文案「不限」。
  const quotaPercent = isMember ? 100 : total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  const quotaLabel = isMember ? '会员 · 不限' : quota ? `${used}/${total}` : '--';

  return (
    <div className={s.panel}>
      <h2 className={s.title}>烛账</h2>
      <p className={s.dim}>烛火状态与收支记录。</p>

      {balanceQuery.isLoading ? (
        <div className={s.placeholder}><p>正在对账...</p></div>
      ) : balanceQuery.isError ? (
        <div className={s.placeholder}><p>烛账暂时取不到，稍后再看。</p></div>
      ) : balanceQuery.data ? (
        <div className={s.statGrid}>
          <div className={s.statCard}>
            <span className={s.mute}>余额</span>
            <strong className={s.statValue}>{balanceQuery.data.balance}</strong>
            <span className={s.badge}>{balanceQuery.data.state}</span>
          </div>
          <div className={s.statCard}>
            <span className={s.mute}>今日额度</span>
            <strong className={s.statValue}>{quotaLabel}</strong>
            <div className={s.progressTrack} aria-hidden="true">
              <span className={s.progressFill} style={{ width: `${quotaPercent}%` }} />
            </div>
          </div>
        </div>
      ) : null}

      <div className={s.section}>
        <p className={s.mute}>最近流水</p>
        {ledgerQuery.isLoading ? (
          <div className={s.placeholder}><p>正在翻账本...</p></div>
        ) : ledgerQuery.isError ? (
          <div className={s.placeholder}><p>流水暂时取不到。</p></div>
        ) : ledgerQuery.data && ledgerQuery.data.length > 0 ? (
          <div className={s.list}>
            {ledgerQuery.data.map((entry) => (
              <div className={s.listRow} key={entry.id}>
                <div>
                  <strong className={s.rowTitle}>{reasonLabel[entry.reason] ?? entry.reason}</strong>
                  <span className={s.rowMeta}>{formatDate(entry.createdAt)}</span>
                </div>
                <span className={entry.delta >= 0 ? s.goodValue : s.badValue}>
                  {entry.delta >= 0 ? '+' : ''}{entry.delta}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className={s.placeholder}><p>还没有流水。</p></div>
        )}
      </div>
    </div>
  );
}
