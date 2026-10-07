// 创建属于你的那位 —— 用户自定义角色卡（feat/user-character-cards P3）
// 流程：表单 → 两步确认（是否公开 / 公序良俗）→ 呼吸灯条 5s → 结束语 → 进入故事 / 完成
import { useState, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_VOICE_NAME, VOICE_OPTIONS, type VoiceName, type HqVoiceProfileId, HQ_VOICE_OPTIONS, defaultHqVoiceProfile, type Character, type UserCharacterCreate } from '@yelan/shared';
import { createMyCharacter } from '../api/my-characters';
import { useSessionStore } from '../stores/sessionStore';
import styles from './CharacterCreate.module.css';

type Step = 'form' | 'confirm1' | 'confirm2' | 'breathing' | 'done';
type Trigger = { word: string; content: string };

const MAX_TRIGGERS = 30;

function splitList(value: string): string[] {
  return value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function CharacterCreate() {
  const goSelect = useSessionStore((s) => s.goSelect);
  const pickCharacter = useSessionStore((s) => s.pickCharacter);
  const userName = useSessionStore((s) => s.userName);
  const queryClient = useQueryClient();

  // —— 表单：世界书 ——
  const [name, setName] = useState('');
  const [voiceName, setVoiceName] = useState<VoiceName>(DEFAULT_VOICE_NAME);
  const [hqVoiceProfileId, setHqVoiceProfileId] = useState<HqVoiceProfileId>(defaultHqVoiceProfile(DEFAULT_VOICE_NAME));
  const [background, setBackground] = useState('');
  const [corePrinciples, setCorePrinciples] = useState('');
  const [rules, setRules] = useState('');
  const [forbiddenRules, setForbiddenRules] = useState('');
  const [triggers, setTriggers] = useState<Trigger[]>([]);
  const [notes, setNotes] = useState('');
  // —— 表单：角色卡 ——
  const [relationshipByUser, setRelationshipByUser] = useState('');
  const [relationshipByChar, setRelationshipByChar] = useState('');
  const [location, setLocation] = useState('');
  const [action, setAction] = useState('');
  const [taboo, setTaboo] = useState('');

  const [step, setStep] = useState<Step>('form');
  const [makePublic, setMakePublic] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const createdRef = useRef<Character | null>(null);

  const addTrigger = () =>
    setTriggers((t) => (t.length >= MAX_TRIGGERS ? t : [...t, { word: '', content: '' }]));
  const updateTrigger = (i: number, patch: Partial<Trigger>) =>
    setTriggers((t) => t.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  const removeTrigger = (i: number) => setTriggers((t) => t.filter((_, idx) => idx !== i));

  const openConfirm = () => {
    if (!name.trim()) {
      setError('至少要给 TA 一个名字。');
      return;
    }
    setError(null);
    setStep('confirm1');
  };

  const buildPayload = useCallback((): UserCharacterCreate => ({
    name: name.trim(),
    voiceName, hqVoiceProfileId,
    worldbook: {
      background: background.trim() || undefined,
      corePrinciples: corePrinciples.trim() || undefined,
      rules: rules.trim() || undefined,
      forbiddenRules: forbiddenRules.trim() || undefined,
      triggers: triggers
        .map((t) => ({ word: t.word.trim(), content: t.content.trim() }))
        .filter((t) => t.word || t.content),
      notes: notes.trim() || undefined,
    },
    card: {
      relationshipByUser: relationshipByUser.trim() || undefined,
      relationshipByChar: relationshipByChar.trim() || undefined,
      initialState: { location: location.trim() || undefined, action: action.trim() || undefined },
      tabooExpressions: splitList(taboo),
    },
    makePublic,
    consent: true,
  }), [name, voiceName, hqVoiceProfileId, background, corePrinciples, rules, forbiddenRules, triggers, notes,
    relationshipByUser, relationshipByChar, location, action, taboo, makePublic]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const resp = await createMyCharacter(buildPayload());
      createdRef.current = resp.character;
      // 让"选择一扇门"重新拉取，本人立即能看到这张私有卡
      void queryClient.invalidateQueries({ queryKey: ['characters'] });
      void queryClient.invalidateQueries({ queryKey: ['voice-characters'] });
      setStep('breathing');
      window.setTimeout(() => setStep('done'), 5000);
    } catch (e) {
      setError((e as Error).message || '创建失败，请稍后再试。');
      setStep('form');
    } finally {
      setBusy(false);
    }
  };

  // —— 呼吸灯条 ——
  if (step === 'breathing') {
    return (
      <div className={styles.root}>
        <div className={styles.center}>
          <div className={styles.breathBar} aria-label="正在铸成" />
        </div>
      </div>
    );
  }

  // —— 结束语 + 出口 ——
  if (step === 'done') {
    return (
      <div className={styles.root}>
        <div className={styles.center}>
          <p className={styles.doneLine}>
            （<span className={styles.doneName}>{userName || '你'}</span>，你的世界，凭听夜阑）
          </p>
          <div className={styles.doneActions}>
            <button
              className={styles.primaryBtn}
              onClick={() => {
                if (createdRef.current) pickCharacter(createdRef.current);
                else goSelect();
              }}
            >
              进入故事
            </button>
            <button className={styles.ghostBtn} onClick={goSelect}>
              完成
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <button className={styles.back} onClick={goSelect} aria-label="返回">
          ‹ 返回
        </button>
        <h2 className={styles.heading}>创建属于你的那位</h2>
        <span className={styles.headerSpacer} />
      </div>

      <div className={styles.scroll}>
        <label className={styles.nameField}>
          <span className={styles.nameLabel}>名字</span>
          <input
            className={styles.nameInput}
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="TA 叫什么（必填）"
            autoFocus
          />
        </label>

        <div className={styles.field}>
          <label htmlFor="custom-character-voice">普通语音音色</label>
          <select id="custom-character-voice" value={voiceName} onChange={e => setVoiceName(e.target.value as VoiceName)}>
            {VOICE_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
          </select>
            <label htmlFor="character-hq-voice">高质量语音音色</label>
            <select id="character-hq-voice" value={hqVoiceProfileId} onChange={e => setHqVoiceProfileId(e.target.value as HqVoiceProfileId)}>
              {HQ_VOICE_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
          <span className={styles.nameLabel}>两种语音模式分别使用对应音色。</span>
        </div>

        {/* —— 世界书 —— */}
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>世界书</h3>
          <Field label="背景" value={background} onChange={setBackground} textarea />
          <Field label="核心原则" value={corePrinciples} onChange={setCorePrinciples} textarea />
          <Field label="规则" value={rules} onChange={setRules} textarea />
          <Field label="禁止规则" value={forbiddenRules} onChange={setForbiddenRules} textarea />

          <div className={styles.field}>
            <div className={styles.triggerHead}>
              <label>触发词</label>
              <span className={styles.triggerCount}>{triggers.length}/{MAX_TRIGGERS}</span>
            </div>
            <div className={styles.triggerList}>
              {triggers.map((t, i) => (
                <div key={i} className={styles.triggerRow}>
                  <input
                    className={styles.triggerWord}
                    value={t.word}
                    maxLength={40}
                    onChange={(e) => updateTrigger(i, { word: e.target.value })}
                    placeholder="词"
                  />
                  <input
                    className={styles.triggerContent}
                    value={t.content}
                    maxLength={500}
                    onChange={(e) => updateTrigger(i, { content: e.target.value })}
                    placeholder="触发时的设定"
                  />
                  <button className={styles.triggerDel} onClick={() => removeTrigger(i)} aria-label="删除">
                    ×
                  </button>
                </div>
              ))}
            </div>
            {triggers.length < MAX_TRIGGERS && (
              <button className={styles.addBtn} onClick={addTrigger}>
                + 添加触发词
              </button>
            )}
          </div>

          <Field label="备注" value={notes} onChange={setNotes} textarea />
        </section>

        {/* —— 角色卡 —— */}
        <section className={styles.block}>
          <h3 className={styles.blockTitle}>角色卡</h3>
          <Field label="你认为的关系" value={relationshipByUser} onChange={setRelationshipByUser} textarea />
          <Field label="角色认为的关系" value={relationshipByChar} onChange={setRelationshipByChar} textarea />
          <div className={styles.stateRow}>
            <Field label="初始位置" value={location} onChange={setLocation} />
            <Field label="初始动作" value={action} onChange={setAction} />
          </div>
          <Field
            label="禁忌表达（逗号或换行分隔）"
            value={taboo}
            onChange={setTaboo}
            textarea
          />
        </section>

        {error && <p className={styles.error}>{error}</p>}
      </div>

      <div className={styles.footer}>
        <button className={styles.primaryBtn} onClick={openConfirm}>
          生成
        </button>
      </div>

      {/* —— 两步确认 —— */}
      {step === 'confirm1' && (
        <div className={styles.overlay} onClick={() => setStep('form')}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <p className={styles.dialogTitle}>是否希望角色卡被公开？</p>
            <p className={styles.dialogSub}>（选择公开并通过审核后，角色将被开放为常驻角色）</p>
            <div className={styles.dialogActions}>
              <button
                className={styles.primaryBtn}
                onClick={() => { setMakePublic(true); setStep('confirm2'); }}
              >
                希望公开
              </button>
              <button
                className={styles.ghostBtn}
                onClick={() => { setMakePublic(false); setStep('confirm2'); }}
              >
                仅自己使用
              </button>
            </div>
          </div>
        </div>
      )}

      {step === 'confirm2' && (
        <div className={styles.overlay} onClick={() => setStep('form')}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
            <p className={styles.dialogTitle}>请确认角色卡符合公序良俗</p>
            <p className={styles.dialogSub}>（角色卡不应包括恐怖暴力、政治敏感等违反供应商协议的内容）</p>
            <div className={styles.dialogActions}>
              <button className={styles.primaryBtn} disabled={busy} onClick={submit}>
                {busy ? '铸成中…' : '我确认'}
              </button>
              <button className={styles.ghostBtn} disabled={busy} onClick={() => setStep('confirm1')}>
                返回
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange, textarea }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  textarea?: boolean;
}) {
  return (
    <div className={styles.field}>
      <label>{label}</label>
      {textarea ? (
        <textarea value={value} maxLength={2000} onChange={(e) => onChange(e.target.value)} rows={2} />
      ) : (
        <input value={value} maxLength={200} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
