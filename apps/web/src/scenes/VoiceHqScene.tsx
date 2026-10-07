import { useEffect, useRef, useState } from 'react';
import type { HqTurnResponse, HqSessionResponse } from '@yelan/shared';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, getToken, getCurrentUserId } from '../api/client';
import { listCharacters } from '../api/characters';
import { env } from '../config/env';
import { useSessionStore } from '../stores/sessionStore';
import styles from './VoiceScene.module.css';
import hqStyles from './VoiceHqScene.module.css';
import { PcmPlayer } from '../voice/pcm-player';

const ERRORS: Record<string, string> = {
  HQ_FISH_HTTP_401: '语音服务鉴权失败，请联系管理员检查 Fish 配置。',
  HQ_FISH_HTTP_402: '语音服务额度不足，请联系管理员。',
  HQ_FISH_HTTP_429: '语音服务繁忙，稍后可以重试合成。',
  HQ_VOICE_UNAVAILABLE: '所选音色已停用，请联系管理员更换音色。',
  HQ_MAIN_NOT_CONFIGURED: '文字主模型尚未配置。',
  HQ_TTS_NOT_CONFIGURED: '语音合成尚未配置。',
  HQ_CONTEXT_LIMIT: '这段对话已经很长了，请开始新会话。',
  HQ_TOKEN_LIMIT: '当前对话额度不足，请稍后再试。',
  HQ_ASR_SUBMISSION_UNKNOWN: '识别提交结果不确定，已停止，未重复提交。',
  HQ_ASR_TIMEOUT: '识别还没完成，可以继续查询原任务。',
  HQ_ASR_TASK_FAILED: '识别失败，请重新录音。',
  LOCAL_ASR_SKIPPED: '本地已跳过 ASR，请用下方测试文字验收回复与语音。',
  HQ_STAGE_FAILED: '处理未完成，已保留本轮状态。',
  HQ_TTS_FAILED: '语音合成失败，可以重试合成。',

  VOICE_RELAY_NOT_CONFIGURED: '语音服务暂未配置好，请稍后再试。',
  VOICE_USER_BUSY: '上一句还在处理中，请稍等。',
  VOICE_RATE_LIMITED: '说得有点急，稍等一会再试。',
  VOICE_PRELUDE_UNAVAILABLE: '语音提示卡暂不可用，请联系管理员。',
  VOICE_RESPONSE_TIMEOUT: '回复超时，请稍后再试。',
  AUDIO_TOO_LONG: '录音请控制在两分钟以内。',
  AUDIO_EMPTY: '没有录到声音，请再试一次。',
};

export function VoiceHqScene() {
  const goOpening = useSessionStore(s => s.goOpening);
  const goLogin = useSessionStore(s => s.goHqVoiceLogin);
  const loggedIn = Boolean(getToken());
  const { data: characters = [], error: characterError, isLoading } = useQuery({ queryKey: ['voice-hq-characters', getCurrentUserId()], queryFn: listCharacters, enabled: loggedIn });
  const { data: config } = useQuery({ queryKey: ['voice-hq-config'], queryFn: () => api<{ localTest: boolean }>('/api/voice-hq/config'), enabled: loggedIn });
  const [testText, setTestText] = useState('今天有点累，陪我说几句话吧。');
  const [playPending, setPlayPending] = useState(false);
  const pending = useRef<{ key: string; body: Blob | string } | null>(null);
  const played = useRef(new Set<string>());
  const [selected, setSelected] = useState('');
  const characterId = selected || characters.find(c => c.isActive)?.id || '';
  const [conversationStarted, setConversationStarted] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'arming' | 'recording' | 'busy'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [currentReply, setCurrentReply] = useState<HqTurnResponse | null>(null);
  const [revealedReply, setRevealedReply] = useState('');
  const [ifActive, setIfActive] = useState(false);
  const [temperature, setTemperature] = useState<number | null>(null);
  const displayTurnId = useRef<string | null>(null);
  const [recoverable, setRecoverable] = useState(false);
  const player = useRef(new PcmPlayer());
  const closed = useRef(false);
  const storageKey = `yelan.voiceHqSession.${getCurrentUserId() ?? 'guest'}`;
  const session = useRef<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef<AbortController | null>(null);
  const alive = useRef(true);
  const lock = useRef(false);
  const held = useRef<number | 'keyboard' | null>(null);
  const meter = useRef<{ context: AudioContext; frame: number } | null>(null);
  const bars = useRef<HTMLSpanElement | null>(null);
  const recordStartedAt = useRef(0);

  useEffect(() => {
    alive.current = true;
    const pcmPlayer = player.current;
    const controller = new AbortController();
    request.current = controller;
    let saved: string | null = null;
    try { saved = localStorage.getItem(storageKey); } catch { /* storage unavailable */ }
    if (loggedIn && saved) void restore(saved, controller);
    return () => {
      alive.current = false; controller.abort(); request.current?.abort();
      pcmPlayer.dispose();
      held.current = null; stopMeter();
      if (recorder.current?.state === 'recording') { recorder.current.onstop = null; recorder.current.stop(); }
      stream.current?.getTracks().forEach(t => t.stop());
      // Leaving the page detaches playback; generation and saved history survive.
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (phase !== 'recording') return;
    const timer = window.setInterval(() => setSeconds(s => s + 1), 1000);
    const stop = window.setTimeout(() => endRecording(true), 119000);
    return () => { clearInterval(timer); clearTimeout(stop); };
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const cancel = () => endRecording(false);
    const hidden = () => { if (document.hidden) cancel(); };
    window.addEventListener('blur', cancel);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('blur', cancel); document.removeEventListener('visibilitychange', hidden); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function report(e: unknown) {
    if (!alive.current) return;
    const err = e as { code?: string; name?: string };
    if (err.name === 'AbortError') return;
    if (err.code?.startsWith('AUTH_')) { setError('登录已过期，请重新登录。'); return; }
    setError(ERRORS[err.code ?? ''] || (err.name === 'NotAllowedError' ? '请允许麦克风权限后再试。' : '这次没有接通，请稍后再试。'));
  }
  function resetSession() {
    stopPlayback();
    if (session.current) void api(`/api/voice-hq/sessions/${session.current}/close`, { method: 'POST' }).catch(() => {});
    session.current = null; closed.current = false; remember(null);
    pending.current = null; setPlayPending(false); setConversationStarted(false);
    setIfActive(false); setTemperature(null);
    displayTurnId.current = null; setCurrentReply(null); setRevealedReply(''); setError(''); setNotice(''); setRecoverable(false);
  }
  function remember(id: string | null) {
    try { if (id) localStorage.setItem(storageKey, id); else localStorage.removeItem(storageKey); } catch { /* noop */ }
  }
  function stopPlayback() {
    player.current.stop();
  }
  function updateTurn(turn: HqTurnResponse) {
    if (!alive.current || displayTurnId.current !== turn.id) return;
    setIfActive(Boolean(turn.ifActive));
    if (turn.temperature != null) setTemperature(turn.temperature);
    setCurrentReply(previous => previous?.status !== 'processing' && previous?.id === turn.id && turn.status === 'processing' ? previous : turn);
  }
  async function playReply(turn: HqTurnResponse, controller: AbortController) {
    if (played.current.has(turn.id)) return;
    const heardKey = `${storageKey}.heard.${turn.id}`;
    try { if (sessionStorage.getItem(heardKey)) return; } catch { /* noop */ }
    const response = await fetch(`${env.apiBase}/api/voice-hq/sessions/${turn.sessionId}/turns/${turn.id}/audio`, {
      headers: { Authorization: `Bearer ${getToken()}` }, signal: controller.signal,
    });
    if (!response.ok) throw new ApiError(response.status, 'AUDIO_UNAVAILABLE', '');
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (controller.signal.aborted) return;
    const characters = Array.from(turn.outputText);
    let revealedCount = 0;
    if (!player.current.append(bytes, progress => {
      if (!alive.current || controller.signal.aborted || displayTurnId.current !== turn.id) return;
      const count = Math.min(characters.length, Math.floor(progress * characters.length) + 1);
      if (count === revealedCount) return;
      revealedCount = count;
      setRevealedReply(characters.slice(0, count).join(''));
      // Restore only text already revealed by playback, never the full server reply.
      try { sessionStorage.setItem(`${storageKey}.revealed.${turn.id}`, String(count)); } catch { /* noop */ }
    })) { setPlayPending(true); setNotice('回复已准备好，点击播放。'); return; }
    played.current.add(turn.id);
    try { sessionStorage.setItem(heardKey, '1'); } catch { /* noop */ }
    setPlayPending(false); setNotice('正在为你播放');
    await player.current.drain(controller.signal);
    if (!controller.signal.aborted) setNotice('听完了，慢慢说。');
  }
  async function watchTurn(initial: HqTurnResponse, controller: AbortController) {
    const base = `/api/voice-hq/sessions/${initial.sessionId}/turns/${initial.id}`;
    let turn = initial;
    const deadline = Date.now() + 600000;
    const labels: Record<string, string> = { uploading: '正在保存录音…', asr_submitting: '正在提交识别…', asr_pending: '正在识别…', main: '正在想怎么回应你…', tts: '正在生成声音…' };
    while (!controller.signal.aborted) {
      updateTurn(turn);
      if (turn.status !== 'processing') {
        setRecoverable(false);
        if (turn.localAsrSkipped && turn.stage === 'asr_skipped') { setNotice(ERRORS.LOCAL_ASR_SKIPPED!); return; }
        if (turn.status === 'complete') { setError(''); await playReply(turn, controller); return; }
        setError(ERRORS[turn.errorCode ?? ''] ?? (turn.canRetryTts ? '文字已保存，语音未完成，可以重试合成。' : '本轮未完成，已保留处理状态。'));
        setNotice(''); return;
      }
      setNotice(labels[turn.stage] ?? '正在处理…');
      if (Date.now() > deadline) throw new Error('Polling timeout');
      await new Promise(resolve => setTimeout(resolve, 900));
      turn = await api<HqTurnResponse>(base, { signal: controller.signal });
    }
  }
  async function restore(id: string, controller: AbortController, resumeLatest = false) {
    lock.current = true; setPhase('busy'); setNotice('正在恢复会话…'); setError('');
    session.current = id;
    try {
      const saved = await api<HqSessionResponse>(`/api/voice-hq/sessions/${id}`, { signal: controller.signal });
      const history = await api<{ turns: HqTurnResponse[] }>(`/api/voice-hq/sessions/${id}/turns`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSelected(saved.characterId); closed.current = Boolean(saved.closedAt);
      setIfActive(Boolean(saved.ifActive)); setTemperature(null);
      setRecoverable(false); setNotice('按住麦克风说话，松开发送');
      pending.current = null;
      const latest = history.turns.at(-1);
      if (latest) {
        displayTurnId.current = latest.id; updateTurn(latest); setConversationStarted(true);
        let count = 0;
        try { count = Number(sessionStorage.getItem(`${storageKey}.revealed.${latest.id}`)) || 0; } catch { /* noop */ }
        setRevealedReply(Array.from(latest.outputText).slice(0, Math.max(0, count)).join(''));
      }
      const resumable = history.turns.find(t => t.status === 'processing') ?? (resumeLatest ? latest : undefined);
      if (resumable) {
        setConversationStarted(true); displayTurnId.current = resumable.id; updateTurn(resumable);
        await watchTurn(resumable, controller);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof ApiError && e.status === 404) { remember(null); session.current = null; setIfActive(false); setTemperature(null); setNotice(''); setRecoverable(false); }
      else { setRecoverable(true); report(e); }
    } finally { if (!controller.signal.aborted && alive.current) { lock.current = false; setPhase('idle'); } }
  }
  async function send(input: Blob | string, retryKey?: string) {
    stopPlayback(); setRevealedReply(''); setPlayPending(false); setRecoverable(false);
    lock.current = true; setPhase('busy'); setError(''); setNotice('正在发送…');
    setConversationStarted(true); void player.current.unlock().catch(() => {});
    const controller = new AbortController(); request.current = controller;
    const key = retryKey ?? crypto.randomUUID();
    pending.current = { key, body: input };
    try {
      if (!session.current || closed.current) {
        setIfActive(false); setTemperature(null);
        const created = await api<{ id: string }>('/api/voice-hq/sessions', { method: 'POST', body: JSON.stringify({ characterId }), signal: controller.signal });
        if (controller.signal.aborted) return;
        session.current = created.id; closed.current = false; remember(created.id);
      }
      const isText = typeof input === 'string';
      const turn = await api<HqTurnResponse>(`/api/voice-hq/sessions/${session.current}/turns${isText ? '/text' : ''}`, {
        method: 'POST', headers: { 'Content-Type': isText ? 'application/json' : input.type || 'audio/webm', 'Idempotency-Key': key },
        body: isText ? JSON.stringify({ text: input }) : input, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      pending.current = null; displayTurnId.current = turn.id; updateTurn(turn);
      await watchTurn(turn, controller);
    } catch (e) {
      if (!controller.signal.aborted) {
        // Keep the exact body/key only for an uncertain upload; never silently create a second turn.
        if (e instanceof ApiError && e.status < 500) pending.current = null;
        report(e); setNotice(''); setRecoverable(Boolean(session.current));
      }
    } finally { lock.current = false; if (alive.current) setPhase('idle'); }
  }
  async function retryStage(kind: 'retry-tts' | 'resume-asr') {
    if (!currentReply || lock.current) return;
    lock.current = true; setPhase('busy'); setError('');
    void player.current.unlock().catch(() => {});
    const controller = new AbortController(); request.current = controller;
    try {
      const turn = await api<HqTurnResponse>(`/api/voice-hq/sessions/${currentReply.sessionId}/turns/${currentReply.id}/${kind}`, {
        method: 'POST', headers: { 'Idempotency-Key': crypto.randomUUID() }, signal: controller.signal,
      });
      await watchTurn(turn, controller);
    } catch (e) { report(e); setRecoverable(true); }
    finally { lock.current = false; if (alive.current) setPhase('idle'); }
  }
  function stopMeter() {
    if (meter.current) {
      cancelAnimationFrame(meter.current.frame);
      void meter.current.context.close().catch(() => {});
      meter.current = null;
    }
  }
  function startMeter(media: MediaStream, context: AudioContext) {
    const source = context.createMediaStreamSource(media);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser); // No destination connection: never echo the microphone.
    const data = new Uint8Array(analyser.fftSize);
    let level = 0;
    const tick = () => {
      if (meter.current?.context !== context) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) sum += ((sample - 128) / 128) ** 2;
      const target = Math.min(1, Math.sqrt(sum / data.length) * 7);
      level += (target - level) * (target > level ? 0.55 : 0.18);
      const weights = [0.45, 0.72, 0.9, 1, 0.85, 0.65, 0.4];
      bars.current?.querySelectorAll('i').forEach((bar, index) => {
        bar.style.transform = `scaleY(${0.16 + level * weights[index]! * 0.84})`;
      });
      meter.current.frame = requestAnimationFrame(tick);
    };
    meter.current = { context, frame: requestAnimationFrame(tick) };
  }
  function endRecording(submit: boolean) {
    if (held.current === null) return;
    held.current = null;
    stopMeter();
    const rec = recorder.current;
    if (rec?.state === 'recording') {
      if (!submit || performance.now() - recordStartedAt.current < 250) {
        rec.onstop = null; rec.stop(); stream.current?.getTracks().forEach(t => t.stop());
        recorder.current = null; lock.current = false;
        setPhase('idle'); setNotice(submit ? '录音太短，请按住说完再松开。' : '录音已取消');
      } else {
        setPhase('busy'); setNotice('正在发送…'); rec.stop();
      }
    } else if (lock.current) {
      // getUserMedia may still be awaiting permission. Its result must not start
      // recording after release; keep the lock until that request settles.
      setNotice('已松开，授权后请重新按住说话。');
    }
  }
  async function startRecording(input: number | 'keyboard') {
    if (lock.current || phase !== 'idle') return;
    if (error.includes('登录')) { goLogin(); return; }
    if (recoverable && pending.current) { void send(pending.current.body, pending.current.key); return; }
    if (recoverable && session.current) {
      stopPlayback(); void player.current.unlock().catch(() => {});
      const controller = new AbortController(); request.current = controller;
      void restore(session.current, controller, true); return;
    }
    if (!characterId) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { setError('当前浏览器无法录音，请使用 HTTPS 或本机 localhost 打开。'); return; }
    held.current = input;
    stopPlayback(); void player.current.unlock().catch(() => {});
    lock.current = true; setPhase('arming'); setNotice('等待麦克风授权，保持按住…'); setError('');
    let context: AudioContext | undefined;
    try {
      context = new AudioContext();
      void context.resume().catch(() => {});
      meter.current = { context, frame: 0 };
      const media = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true }, video: false });
      if (!alive.current || held.current !== input) {
        media.getTracks().forEach(t => t.stop()); stopMeter(); lock.current = false;
        if (alive.current) { setPhase('idle'); setNotice('按住麦克风说话，松开发送'); }
        return;
      }
      stream.current = media;
      const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(m => MediaRecorder.isTypeSupported(m));
      const rec = new MediaRecorder(media, mimeType ? { mimeType, audioBitsPerSecond: 24000 } : undefined);
      recorder.current = rec; const chunks: Blob[] = [];
      rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data); };
      rec.onerror = () => { held.current = null; stopMeter(); rec.onstop = null; media.getTracks().forEach(t => t.stop()); lock.current = false; if (alive.current) { setPhase('idle'); setError('录音失败，请重新尝试。'); } };
      rec.onstop = () => { stopMeter(); recorder.current = null; media.getTracks().forEach(t => t.stop()); if (alive.current) void send(new Blob(chunks, { type: rec.mimeType })); };
      rec.start(250); recordStartedAt.current = performance.now();
      setConversationStarted(true); displayTurnId.current = null; setCurrentReply(null); setRevealedReply('');
      startMeter(media, context); setSeconds(0); setPhase('recording'); setNotice('正在聆听，松开结束并发送');
    } catch (e) { held.current = null; stopMeter(); lock.current = false; stream.current?.getTracks().forEach(t => t.stop()); if (alive.current) { setPhase('idle'); setNotice(''); } report(e); }
  }

  const replyText = error
    ? `${error}${recoverable ? ' 按语音按钮恢复会话。' : ''}`
    : characterError ? '角色加载失败，请返回后重试。' : revealedReply;
  const micLabel = error.includes('登录') ? '重新登录'
    : recoverable ? '恢复会话' : phase === 'recording' ? '正在录音，松开发送' : '按住说话，松开发送';

  return <section className={`${styles.root} ${hqStyles.root} ${conversationStarted ? styles.minimal : ''}`}>
    <header className={styles.header}>
      <button onClick={goOpening} className={styles.back} aria-label="返回">←</button>
      {!conversationStarted && <><span>夜阑 · 语音（高质量）</span><span className={styles.tag}>一盏茶的时间</span></>}
      {ifActive && <div className={hqStyles.tempBadge} role="status" aria-label={temperature == null ? 'IF 已生效，温度计算中' : `IF 已生效，当前温度 ${temperature}/5`} title="当前对话温度">
        {temperature == null ? '🌡️' : temperature >= 4 ? '🔥' : temperature <= 2 ? '❄️' : '🌡️'} {temperature ?? '—'}/5
      </div>}
    </header>
    <div className={`${styles.main} ${hqStyles.main}`}>
      {!conversationStarted && <><p className={styles.eyebrow}>让声音靠近一点</p><h1>就在这</h1></>}
      {!loggedIn ? <div className={styles.empty}><p>登录后，和你选的人慢慢聊。</p><button className={styles.primary} onClick={goLogin}>登录 / 注册</button></div> : <>
        {!conversationStarted && <>
          <div className={styles.selectors}>
            <label>和谁聊<select aria-label="选择角色" value={characterId} disabled={phase !== 'idle'} onChange={e => { resetSession(); setSelected(e.target.value); }}>
              {!characterId && <option value="">{isLoading ? '正在寻找…' : '暂无可用角色'}</option>}
              {characters.filter(c => c.isActive).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select></label>
          </div>
          <div className={styles.empty}><span className={styles.moon}>◌</span><p>不必想好开场，开口就好。</p></div>
        </>}
        <p className={`${styles.reply} ${error || characterError ? styles.error : ''}`} role={error || characterError ? 'alert' : undefined} aria-live="polite">
          {error || characterError ? replyText : Array.from(revealedReply).map((character, index) =>
            character === '\n' ? <br key={`${currentReply?.id}:${index}`} /> :
              <span key={`${currentReply?.id}:${index}`} className={hqStyles.replyCharacter}>{character}</span>,
          )}
        </p>
        <div className={`${styles.controls} ${hqStyles.controls}`}>
          {currentReply?.canRetryTts && <button className={styles.primary} disabled={phase !== 'idle'} onClick={() => void retryStage('retry-tts')}>重试语音合成</button>}
          {currentReply?.canResumeAsr && <button className={styles.primary} disabled={phase !== 'idle'} onClick={() => void retryStage('resume-asr')}>继续查询识别</button>}
          {playPending && <button className={styles.primary} disabled={phase !== 'idle'} onClick={() => {
            if (!currentReply || lock.current) return;
            lock.current = true; setPhase('busy');
            const controller = new AbortController(); request.current = controller;
            void player.current.unlock().then(() => playReply(currentReply, controller)).catch(report)
              .finally(() => { lock.current = false; if (alive.current) setPhase('idle'); });
          }}>播放回复</button>}
          {config?.localTest && <div className={styles.localTest}>
            <p>本地验收 · 已跳过签名与 ASR，输入测试文字验证回复和语音。</p>
            <textarea aria-label="本地测试文字" value={testText} maxLength={4000} disabled={phase !== 'idle'} onChange={e => setTestText(e.target.value)} />
            <button className={styles.primary} disabled={phase !== 'idle' || recoverable || !characterId || !testText.trim()} onClick={() => void send(testText.trim())}>发送测试文字</button>
          </div>}
          {conversationStarted && <button className={styles.back} disabled={phase !== 'idle' || recoverable} onClick={resetSession}>开始新会话</button>}
          <p className={styles.status} role="status">{phase === 'recording' ? `录音中 · ${seconds}s · 松开发送` : notice || '按住麦克风说话，松开发送'}</p>
          <button type="button" aria-label={micLabel} aria-pressed={phase === 'recording'}
            className={`${styles.mic} ${phase === 'recording' ? styles.recording : ''}`} disabled={phase === 'busy' || (!characterId && !recoverable && !error.includes('登录'))}
            onPointerDown={e => { if (e.button !== 0 || !e.isPrimary || lock.current) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); void startRecording(e.pointerId); }}
            onPointerUp={e => { if (held.current === e.pointerId) endRecording(true); }}
            onPointerCancel={e => { if (held.current === e.pointerId) endRecording(false); }}
            onLostPointerCapture={e => { if (held.current === e.pointerId) endRecording(false); }}
            onContextMenu={e => e.preventDefault()}
            onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (!e.repeat) void startRecording('keyboard'); } else if (e.key === 'Escape') endRecording(false); }}
            onKeyUp={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (held.current === 'keyboard') endRecording(true); } }}
            onBlur={() => endRecording(false)}>
            {phase === 'busy' || phase === 'arming' ? '…' : phase === 'recording'
              ? <span ref={bars} className={styles.volumeBars} aria-hidden="true">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</span>
              : <svg width="27" height="32" viewBox="0 0 24 30" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><rect x="8" y="2" width="8" height="16" rx="4"/><path d="M4 13v2a8 8 0 0 0 16 0v-2M12 23v5M7 28h10"/></svg>}
          </button>
        </div>
      </>}
    </div>
  </section>;
}
