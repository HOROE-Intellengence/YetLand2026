// 入场问候选择 — 不同问候语对应进入心境，影响首条 prompt 注入
import { useSessionStore } from '../stores/sessionStore';
import styles from './OpeningScene.module.css';

const GREETINGS = [
  '今晚，想和谁说话？',
  '有些事，只想说给一个人听。',
  '夜还长，慢慢来。',
  '又见面了。',
];

export function OpeningScene() {
  const setGreeting = useSessionStore((s) => s.setGreeting);
  const goLogin = useSessionStore((s) => s.goLogin);

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>夜阑</h1>
      <p className={styles.subtitle}>
        夜深了。这里有一段等着你的对白。
      </p>
      <div className={styles.greetings}>
        {GREETINGS.map((g) => (
          <button
            key={g}
            className={styles.greetBtn}
            onClick={() => setGreeting(g)}
          >
            {g}
          </button>
        ))}
      </div>
      <button className={styles.enterBtn} onClick={() => setGreeting('')}>
        直接进入
      </button>
      <button
        className={styles.enterBtn}
        onClick={goLogin}
        style={{ marginTop: 8, opacity: 0.7 }}
        type="button"
      >
        我已经有账号
      </button>
    </div>
  );
}
