// 入场问候选择 — 不同问候语对应进入心境，影响首条 prompt 注入
import { useSessionStore } from '../stores/sessionStore';
import styles from './OpeningScene.module.css';

export function OpeningScene() {
  const setGreeting = useSessionStore((s) => s.setGreeting);
  const goLogin = useSessionStore((s) => s.goLogin);
  const goVoice = useSessionStore((s) => s.goVoice);
  const goHqVoice = useSessionStore((s) => s.goHqVoice);
  const goApi = useSessionStore((s) => s.goApi);
  const goPhone = useSessionStore((s) => s.goPhone);

  return (
    <div className={styles.root}>
      <h1 className={styles.title}>夜阑</h1>
      <p className={styles.subtitle}>
        夜深了。这里有一段等着你的对白。
      </p>
      <div className={styles.greetings}>
        <button className={styles.greetBtn} onClick={() => setGreeting('夜还长，慢慢来')}>夜还长，慢慢来</button>
        <button className={styles.greetBtn} onClick={goVoice}>
          如枕边语
          <svg className={styles.micIcon} width="16" height="20" viewBox="0 0 24 30" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
            <rect x="8" y="2" width="8" height="16" rx="4" />
            <path d="M4 13v2a8 8 0 0 0 16 0v-2M12 23v5M7 28h10" />
          </svg>
        </button>
        <button className={styles.greetBtn} type="button" onClick={goHqVoice}>语音（高质量）</button>
        <button className={styles.greetBtn} type="button" onClick={goApi}>API调用</button>
        <button className={styles.greetBtn} type="button" onClick={goPhone}>小手机</button>
      </div>
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
