// 成就触达闪屏 — 不打断当前叙事，顶部浮动自动消失
import { useEffect } from 'react';
import { useSessionStore } from '../../stores/sessionStore';
import styles from './AchievementFlash.module.css';

export function AchievementFlash() {
  const ach = useSessionStore((s) => s.achievement);
  const clear = useSessionStore((s) => s.clearAchievement);

  useEffect(() => {
    if (!ach) return;
    const t = setTimeout(clear, 4000);
    return () => clearTimeout(t);
  }, [ach, clear]);

  if (!ach) return null;

  return (
    <div className={styles.flash}>
      <div className={styles.icon}>印</div>
      <div className={styles.name}>{ach.name ?? ach.slug}</div>
      {ach.description && <div className={styles.desc}>{ach.description}</div>}
    </div>
  );
}
