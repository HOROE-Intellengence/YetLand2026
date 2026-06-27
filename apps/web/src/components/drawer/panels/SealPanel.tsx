// 印 — 成就页
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { listAchievements, myAchievements } from '../../../api/achievements';
import s from './panel.module.css';

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function SealPanel() {
  const achievementsQuery = useQuery({ queryKey: ['achievements'], queryFn: listAchievements });
  const mineQuery = useQuery({ queryKey: ['me', 'achievements'], queryFn: myAchievements });
  const unlocked = useMemo(
    () => new Map((mineQuery.data ?? []).map((row) => [row.achievementId, row])),
    [mineQuery.data],
  );
  const total = achievementsQuery.data?.length ?? 0;
  const done = achievementsQuery.data?.filter((item) => unlocked.has(item.id)).length ?? 0;

  return (
    <div className={s.panel}>
      <h2 className={s.title}>印</h2>
      <p className={s.dim}>那些值得被记住的瞬间。</p>

      <div className={s.statCard}>
        <span className={s.mute}>已点亮</span>
        <strong className={s.statValue}>{done}/{total}</strong>
        <div className={s.progressTrack} aria-hidden="true">
          <span className={s.progressFill} style={{ width: total ? `${Math.round((done / total) * 100)}%` : '0%' }} />
        </div>
      </div>

      {achievementsQuery.isLoading ? (
        <div className={s.placeholder}><p>正在拓印...</p></div>
      ) : achievementsQuery.isError ? (
        <div className={s.placeholder}><p>成就暂时取不到。</p></div>
      ) : achievementsQuery.data && achievementsQuery.data.length > 0 ? (
        <div className={s.cardList}>
          {achievementsQuery.data.map((item) => {
            const row = unlocked.get(item.id);
            return (
              <article className={`${s.itemCard} ${row ? '' : s.mutedCard}`} key={item.id}>
                <div className={s.itemHeader}>
                  <div>
                    <h3 className={s.itemName}>{item.name}</h3>
                    <p className={s.rowMeta}>{item.description}</p>
                  </div>
                  <span className={s.badge}>{row ? '已解锁' : '未解锁'}</span>
                </div>
                <div className={s.listRow}>
                  <span className={s.mute}>奖励</span>
                  <span className={s.goodValue}>+{item.rewardCandle}</span>
                </div>
                {row && <p className={s.success}>点亮于 {formatDate(row.unlockedAt)}</p>}
              </article>
            );
          })}
        </div>
      ) : (
        <div className={s.placeholder}><p>暂无成就。</p></div>
      )}
    </div>
  );
}
