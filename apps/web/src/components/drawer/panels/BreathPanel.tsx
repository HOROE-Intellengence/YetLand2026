// 调息 — 呼吸节奏 / 字号 / 粒子强度等设置
import { useState } from 'react';
import { describeApiBase, setApiBase } from '../../../config/env';
import { usePreferencesStore } from '../../../stores/preferencesStore';
import s from './panel.module.css';

export function BreathPanel() {
  const theme = usePreferencesStore((state) => state.theme);
  const fontScale = usePreferencesStore((state) => state.fontScale);
  const locale = usePreferencesStore((state) => state.locale);
  const setTheme = usePreferencesStore((state) => state.setTheme);
  const setFontScale = usePreferencesStore((state) => state.setFontScale);
  const setLocale = usePreferencesStore((state) => state.setLocale);
  const apiInfo = describeApiBase();
  const [baseDraft, setBaseDraft] = useState(apiInfo.base);

  return (
    <div className={s.panel}>
      <h2 className={s.title}>调息</h2>
      <p className={s.dim}>调整属于你的节奏和样式。</p>

      <div className={s.section}>
        <p className={s.mute}>主题</p>
        <div className={s.segmented}>
          <button
            className={`${s.segmentBtn} ${theme === 'dark' ? s.segmentBtnActive : ''}`}
            onClick={() => setTheme('dark')}
            type="button"
          >
            夜
          </button>
          <button
            className={`${s.segmentBtn} ${theme === 'light' ? s.segmentBtnActive : ''}`}
            onClick={() => setTheme('light')}
            type="button"
          >
            昼
          </button>
        </div>
      </div>

      <div className={s.section}>
        <label className={s.fieldLabel}>
          <span>字号 {fontScale.toFixed(2)}</span>
          <input
            className={s.range}
            max="1.25"
            min="0.85"
            onChange={(event) => setFontScale(Number(event.target.value))}
            step="0.05"
            type="range"
            value={fontScale}
          />
        </label>
      </div>

      <div className={s.section}>
        <label className={s.fieldLabel}>
          <span>语言</span>
          <select
            className={s.select}
            onChange={(event) => setLocale(event.target.value)}
            value={locale}
          >
            <option value="zh-CN">简体中文</option>
            <option value="zh-TW">繁体中文</option>
            <option value="en-US">English</option>
          </select>
        </label>
      </div>

      <div className={s.section}>
        <p className={s.mute}>API base · {apiInfo.source}</p>
        <input
          className={s.textInput}
          onChange={(event) => setBaseDraft(event.target.value)}
          value={baseDraft}
        />
        <div className={s.actionRow}>
          <button
            className={s.submitBtn}
            onClick={() => setApiBase(baseDraft.trim() || null)}
            type="button"
          >
            应用
          </button>
          <button
            className={s.dangerBtn}
            onClick={() => setApiBase(null)}
            type="button"
          >
            恢复默认
          </button>
        </div>
      </div>
    </div>
  );
}
