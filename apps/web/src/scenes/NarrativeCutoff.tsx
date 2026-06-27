// 免费额度耗尽后的"自然收束"屏；引向续夜或再见
import { useSessionStore } from '../stores/sessionStore';
import { useDrawerStore } from '../stores/drawerStore';
import styles from './NarrativeCutoff.module.css';

export function NarrativeCutoff() {
  const restart = useSessionStore((s) => s.restart);
  const openDrawer = useDrawerStore((s) => s.open);

  return (
    <div className={styles.root}>
      <h2 className={styles.title}>今夜的对白到此为止</h2>
      <p className={styles.body}>
        每一段对话都有它的长度。这不是告别，只是今晚的句点。
        <br />
        明天，门还会为你打开。
      </p>
      <div className={styles.actions}>
        <button className={styles.primaryBtn} onClick={() => openDrawer('subs')}>
          续夜
        </button>
        <button className={styles.secondaryBtn} onClick={restart}>
          回到首页
        </button>
      </div>
    </div>
  );
}
