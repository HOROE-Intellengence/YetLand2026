// 思考中三点 — 角色正在输入的可视反馈
import styles from './TypingDots.module.css';

export function TypingDots() {
  return (
    <span className={styles.dots} aria-label="对方正在输入">
      <span className={styles.dot} />
      <span className={styles.dot} />
      <span className={styles.dot} />
    </span>
  );
}
