import { useSessionStore } from '../stores/sessionStore';
import styles from './OpeningScene.module.css';

function ModeCard({
  symbol,
  label,
  title,
  description,
  onClick,
}: {
  symbol: string;
  label: string;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button className={styles.modeCard} onClick={onClick} type="button">
      <span className={styles.cardTop}>
        <span className={styles.icon} aria-hidden="true">
          {symbol}
        </span>
        <span className={styles.cardLabel}>{label}</span>
      </span>
      <strong>{title}</strong>
      <span className={styles.description}>{description}</span>
      <span className={styles.cardArrow} aria-hidden="true">
        ↗
      </span>
    </button>
  );
}

export function OpeningScene() {
  const { setGreeting, goLogin, goCallModes, goApi, goPhone } = useSessionStore();
  return (
    <main className={styles.root}>
      <div className={styles.inner}>
        <header className={styles.header}>
          <p className={styles.eyebrow}>YETLAND · A MOMENT FOR YOU</p>
          <h1 className={styles.title}>夜阑</h1>
          <p className={styles.subtitle}>夜深了。这里有一段等着你的对白。</p>
        </header>
        <nav className={styles.modes} aria-label="功能选择">
          <ModeCard
            symbol="✦"
            label="文字对话"
            title="夜还长，慢慢来"
            description="落下一句话，让故事从这里开始。"
            onClick={() => setGreeting('夜还长，慢慢来')}
          />
          <ModeCard
            symbol="◌"
            label="声音陪伴"
            title="通话模式"
            description="即时回应，或慢慢听见更细腻的声音。"
            onClick={goCallModes}
          />
          <ModeCard
            symbol="⌁"
            label="连接你的客户端"
            title="API 调用"
            description="把夜阑的表达，带到你习惯的地方。"
            onClick={goApi}
          />
          <ModeCard
            symbol="▯"
            label="角色生活"
            title="小手机"
            description="翻开属于你们的消息、日常与秘密。"
            onClick={goPhone}
          />
        </nav>
        <footer className={styles.footer}>
          <span>今夜，选择一种靠近的方式。</span>
          <button onClick={goLogin} type="button">
            我已经有账号 <span aria-hidden="true">→</span>
          </button>
        </footer>
      </div>
    </main>
  );
}

export function CallModeScene() {
  const { goOpening, goVoice, goHqVoice } = useSessionStore();
  return (
    <main className={styles.root}>
      <div className={styles.inner}>
        <button className={styles.back} onClick={goOpening} type="button">
          ← 返回功能选择
        </button>
        <header className={styles.header}>
          <p className={styles.eyebrow}>YETLAND · VOICE</p>
          <h1 className={`${styles.title} ${styles.callTitle}`}>通话模式</h1>
          <p className={styles.subtitle}>听见回应，也听见陪伴。</p>
        </header>
        <nav className={styles.modes} aria-label="选择通话版本">
          <ModeCard
            symbol="◌"
            label="实时语音回应"
            title="即时通话"
            description="开口就好，让对话自然地接下去。"
            onClick={goVoice}
          />
          <ModeCard
            symbol="✧"
            label="细腻声音表达"
            title="高级通话"
            description="更丰富的音色，慢慢说，也慢慢听。"
            onClick={goHqVoice}
          />
        </nav>
        <p className={styles.callNote}>两种模式都使用你选择的角色与绑定音色。</p>
      </div>
    </main>
  );
}
