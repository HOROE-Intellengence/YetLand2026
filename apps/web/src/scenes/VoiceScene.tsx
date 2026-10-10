import { useEffect, useRef, useState } from 'react';
import type { VoiceTurnResponse } from '@yelan/shared';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError, getToken, getCurrentUserId } from '../api/client';
import { listCharacters } from '../api/characters';
import { env } from '../config/env';
import { useSessionStore } from '../stores/sessionStore';
import styles from './VoiceScene.module.css';
import { consumePcm, PcmPlayer } from '../voice/pcm-player';

const ERRORS: Record<string, string> = {
  VOICE_RELAY_NOT_CONFIGURED: '语音服务暂未配置好，请稍后再试。',
  VOICE_USER_BUSY: '上一句还在处理中，请稍等。',
  VOICE_RATE_LIMITED: '说得有点急，稍等一会再试。',
  VOICE_PRELUDE_UNAVAILABLE: '语音提示卡暂不可用，请联系管理员。',
  VOICE_RESPONSE_TIMEOUT: '回复超时，请稍后再试。',
  AUDIO_TOO_LONG: '录音请控制在两分钟以内。',
  AUDIO_EMPTY: '没有录到声音，请再试一次。',
};

export function VoiceScene() {
  const goOpening = useSessionStore(s => s.goCallModes);
  const goLogin = useSessionStore(s => s.goVoiceLogin);
  const loggedIn = Boolean(getToken());
  const { data: characters = [], error: characterError, isLoading } = useQuery({ queryKey: ['voice-characters', getCurrentUserId()], queryFn: listCharacters, enabled: loggedIn });
  const [selected, setSelected] = useState('');
  const characterId = selected || characters.find(c => c.isActive)?.id || '';
  const [conversationStarted, setConversationStarted] = useState(false);
  const [phase, setPhase] = useState<'idle' | 'arming' | 'recording' | 'busy'>('idle');
  const [seconds, setSeconds] = useState(0);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [currentReply, setCurrentReply] = useState<VoiceTurnResponse | null>(null);
  const displayTurnId = useRef<string | null>(null);
  const [recoverable, setRecoverable] = useState(false);
  const player = useRef(new PcmPlayer());
  const closed = useRef(false);
  const storageKey = `yelan.voiceSession.${getCurrentUserId() ?? 'guest'}`;
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
    if (session.current) void api(`/api/voice/sessions/${session.current}/close`, { method: 'POST' }).catch(() => {});
    session.current = null; closed.current = false; remember(null);
    displayTurnId.current = null; setCurrentReply(null); setError(''); setNotice(''); setRecoverable(false);
  }
  function remember(id: string | null) {
    try { if (id) localStorage.setItem(storageKey, id); else localStorage.removeItem(storageKey); } catch { /* noop */ }
  }
  function stopPlayback() {
    player.current.stop();
  }
  function updateTurn(turn: VoiceTurnResponse) {
    if (!alive.current || displayTurnId.current !== turn.id) return;
    setCurrentReply(previous => previous?.status !== 'processing' && previous?.id === turn.id && turn.status === 'processing' ? previous : turn);
  }
  async function watchTurn(initial: VoiceTurnResponse, controller: AbortController, startedAt?: number) {
    const base = `/api/voice/sessions/${initial.sessionId}/turns/${initial.id}`;
    let offset = 0, heard = false, firstChunk = false, polling = true;
    const deadline = Date.now() + 240000;
    const wait = () => new Promise(resolve => setTimeout(resolve, 900));
    const refresh = async () => {
      while (polling && !controller.signal.aborted) {
        try { const t = await api<VoiceTurnResponse>(base, { signal: controller.signal }); if (!controller.signal.aborted) updateTurn(t); }
        catch { /* streaming reconnect below handles transport/auth errors */ }
        await wait();
      }
    };
    void refresh();
    try {
      while (!controller.signal.aborted && Date.now() < deadline) {
        try {
          const response = await fetch(`${env.apiBase}${base}/audio-stream?offset=${offset}`, {
            headers: { Authorization: `Bearer ${getToken()}` }, signal: controller.signal,
          });
          if (!response.ok) throw new ApiError(response.status, response.status === 401 ? 'AUTH_INVALID' : 'AUDIO_UNAVAILABLE', '');
          if (!response.body) throw new Error('Missing audio stream');
          await consumePcm(response.body, chunk => {
            if (controller.signal.aborted) return;
            const playing = player.current.append(chunk);
            offset += chunk.length;
            if (!firstChunk) {
              firstChunk = true;
              console.info('[voice timing]', JSON.stringify({ turnId: initial.id, event: 'first-audio', elapsedMs: startedAt === undefined ? null : Math.round(performance.now() - startedAt), playbackScheduled: playing }));
            }
            heard ||= playing;
            if (playing) setNotice('正在为你播放');
          });
          const turn = await api<VoiceTurnResponse>(base, { signal: controller.signal });
          if (controller.signal.aborted) return;
          updateTurn(turn);
          if (turn.status !== 'processing') {
            console.info('[voice timing]', JSON.stringify({ turnId: initial.id, event: 'generation-finished', elapsedMs: startedAt === undefined ? null : Math.round(performance.now() - startedAt) }));
            await player.current.drain(controller.signal);
            if (controller.signal.aborted) return;
            if (turn.status !== 'complete') throw new ApiError(422, turn.errorCode || 'VOICE_RESPONSE_TIMEOUT', '');
            setNotice(heard ? '听完了，慢慢说。' : '回复已保存。');
            setError(''); setRecoverable(false); return;
          }
        } catch (e) {
          if (controller.signal.aborted) return;
          if (e instanceof ApiError && e.status < 500) throw e;
          setNotice('连接中断，正在续取原回复…');
        }
        await wait();
      }
      if (!controller.signal.aborted) { setRecoverable(true); throw { code: 'VOICE_RESPONSE_TIMEOUT' }; }
    } finally { polling = false; }
  }
  async function restore(id: string, controller: AbortController, resumeLatest = false) {
    lock.current = true; setPhase('busy'); setNotice('正在恢复会话…'); setError('');
    session.current = id;
    try {
      const saved = await api<{ characterId: string; closedAt: string | null }>(`/api/voice/sessions/${id}`, { signal: controller.signal });
      const history = await api<{ turns: VoiceTurnResponse[] }>(`/api/voice/sessions/${id}/turns`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setSelected(saved.characterId); closed.current = Boolean(saved.closedAt);
      setRecoverable(false); setNotice('按住麦克风说话，松开发送');
      const resumable = history.turns.find(t => t.status === 'processing') ?? (resumeLatest ? history.turns.at(-1) : undefined);
      if (resumable) {
        setConversationStarted(true); displayTurnId.current = resumable.id; updateTurn(resumable);
        await watchTurn(resumable, controller);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      if (e instanceof ApiError && e.status === 404) { remember(null); session.current = null; setNotice(''); setRecoverable(false); }
      else { setRecoverable(true); report(e); }
    } finally { if (!controller.signal.aborted && alive.current) { lock.current = false; setPhase('idle'); } }
  }
  async function send(input: Blob) {
    const startedAt = performance.now();
    stopPlayback(); setRecoverable(false);
    setPhase('busy'); setError(''); setNotice('正在听你说…');
    void player.current.unlock().catch(() => {});
    const controller = new AbortController(); request.current = controller;
    try {
      if (!session.current || closed.current) {
        const created = await api<{ id: string }>('/api/voice/sessions', { method: 'POST', body: JSON.stringify({ characterId }), signal: controller.signal });
        if (controller.signal.aborted) return;
        session.current = created.id; closed.current = false; remember(created.id);
      }
      const base = `/api/voice/sessions/${session.current}/turns`;
      const turn = await api<VoiceTurnResponse>(base, {
        method: 'POST', headers: { 'Content-Type': input.type || 'audio/webm', 'Idempotency-Key': crypto.randomUUID() },
        body: input, signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      displayTurnId.current = turn.id; updateTurn(turn); setNotice('等一声回应…');
      await watchTurn(turn, controller, startedAt);
    } catch (e) { if (!controller.signal.aborted) { report(e); setNotice(''); setRecoverable(Boolean(session.current)); } }
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
      setConversationStarted(true); displayTurnId.current = null; setCurrentReply(null);
      startMeter(media, context); setSeconds(0); setPhase('recording'); setNotice('正在聆听，松开结束并发送');
    } catch (e) { held.current = null; stopMeter(); lock.current = false; stream.current?.getTracks().forEach(t => t.stop()); if (alive.current) { setPhase('idle'); setNotice(''); } report(e); }
  }

  const replyText = error
    ? `${error}${recoverable ? ' 按语音按钮恢复会话。' : ''}`
    : characterError ? '角色加载失败，请返回后重试。' : currentReply?.outputText ?? '';
  const micLabel = error.includes('登录') ? '重新登录'
    : recoverable ? '恢复会话' : phase === 'recording' ? '正在录音，松开发送' : '按住说话，松开发送';

  return <section className={`${styles.root} ${conversationStarted ? styles.minimal : ''}`}>
    <header className={styles.header}>
      <button onClick={goOpening} className={styles.back} aria-label="返回">←</button>
      {!conversationStarted && <><span>夜阑 · 即时通话</span><span className={styles.tag}>一盏茶的时间</span></>}
    </header>
    <div className={styles.main}>
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
        <p className={`${styles.reply} ${error || characterError ? styles.error : ''}`} role={error || characterError ? 'alert' : undefined} aria-live="polite">{replyText}</p>
        <div className={styles.controls}>
          <p className={conversationStarted ? styles.srOnly : styles.status} role="status">{phase === 'recording' ? `录音中 · ${seconds}s · 松开发送` : notice || '按住麦克风说话，松开发送'}</p>
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
