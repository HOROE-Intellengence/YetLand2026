'use client';
import { useEffect, useRef, useState } from 'react';
import type { Character } from '@/lib/character-types';
import { loadChatMessages, pushChatMessage, type ChatSession } from '@/lib/chat-storage';
import { yelanHeaders, yelanRequest } from '@/lib/yelan-managed-client';

type Turn = { id: string; sessionId: string; status: string; inputText: string; outputText: string; outputAudioUrl?: string | null; errorCode?: string | null };
const dataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob);
});

export function YelanVoiceCall({ session, characters, onEnd }: { session: ChatSession; characters: Character[]; onEnd: () => void }) {
  const [characterId, setCharacterId] = useState(characters[0]?.id || '');
  const [kind, setKind] = useState<'voice' | 'voice-hq'>('voice');
  const [recording, setRecording] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [transcript, setTranscript] = useState('');
  const [audioUrl, setAudioUrl] = useState('');
  const [text, setText] = useState('');
  const active = useRef<{ id: string; kind: 'voice' | 'voice-hq' } | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const tracks = useRef<MediaStream | null>(null);
  const abort = useRef(new AbortController());
  const alive = useRef(true);
  const acquiring = useRef(false);
  const submitting = useRef(false);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function closeSession() {
    const previous = active.current; active.current = null;
    if (previous) await yelanRequest(`/${previous.kind}/sessions/${previous.id}/close`, { method: 'POST' }).catch(() => {});
  }
  useEffect(() => {
    alive.current = true;
    abort.current = new AbortController();
    return () => {
      alive.current = false; abort.current.abort();
      if (recordingTimer.current) clearTimeout(recordingTimer.current);
      if (recorder.current) { recorder.current.onstop = null; if (recorder.current.state !== 'inactive') recorder.current.stop(); }
      tracks.current?.getTracks().forEach(track => track.stop()); void closeSession();
    };
  }, []);
  async function ensureSession() {
    if (active.current) return active.current;
    const context = loadChatMessages(session.id).slice(-20).map(message => `${message.role}: ${message.content || message.mediaData?.label || ''}`).join('\n').slice(-12000);
    const created = await yelanRequest<{ id: string; kind: 'voice' | 'voice-hq' }>('/phone/voice/sessions', {
      method: 'POST', signal: abort.current.signal, body: JSON.stringify({ characterId, kind, mode: 'main', context }),
    });
    active.current = created;
    return created;
  }
  async function submit(blob?: Blob) {
    if (submitting.current || (!blob && !text.trim())) return;
    submitting.current = true;
    setBusy(true); setError('');
    try {
      const connection = await ensureSession();
      const base = `/${connection.kind}/sessions/${connection.id}/turns`;
      const response = await fetch(`/api/host${base}${blob ? '' : '/text'}`, {
        method: 'POST', signal: abort.current.signal,
        headers: { ...yelanHeaders(), 'Content-Type': blob?.type || 'application/json', 'Idempotency-Key': crypto.randomUUID() },
        body: blob || JSON.stringify({ text: text.trim() }),
      });
      if (!response.ok) { const failure = await response.json().catch(() => ({})); throw new Error(failure.code || '夜阑通话请求失败'); }
      let turn: Turn = await response.json();
      const deadline = Date.now() + 300000;
      while (turn.status === 'processing' && Date.now() < deadline) {
        await new Promise<void>((resolve, reject) => {
          const cancel = () => { clearTimeout(timer); reject(new Error('通话已结束')); };
          const timer = setTimeout(() => { abort.current.signal.removeEventListener('abort', cancel); resolve(); }, 1000);
          abort.current.signal.addEventListener('abort', cancel, { once: true });
        });
        turn = await yelanRequest<Turn>(`${base}/${turn.id}`, { signal: abort.current.signal });
      }
      if (turn.status !== 'complete') throw new Error(turn.errorCode || '语音生成尚未完成，请稍后重试');
      let encoded = '';
      const audioPath = connection.kind === 'voice-hq' ? `${base}/${turn.id}/audio` : turn.outputAudioUrl;
      if (audioPath) {
        const path = audioPath.replace(/^\/api/, '');
        const audioResponse = await fetch(`/api/host${path}`, { headers: yelanHeaders(), signal: abort.current.signal });
        if (!audioResponse.ok) throw new Error('音频读取失败');
        encoded = await dataUrl(await audioResponse.blob());
      }
      if (!alive.current) return;
      if (turn.inputText) pushChatMessage({ sessionId: session.id, role: 'user', content: turn.inputText });
      pushChatMessage({ sessionId: session.id, role: 'assistant', content: '', mediaType: 'audio', mediaUrl: encoded,
        senderCharacterId: characterId, senderName: characters.find(character => character.id === characterId)?.name,
        mediaData: { label: turn.outputText, synthesizedFromText: turn.outputText } });
      setTranscript(turn.outputText); setAudioUrl(encoded); setText('');
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : '通话失败'); }
    finally { submitting.current = false; if (alive.current) setBusy(false); }
  }
  async function startRecording() {
    if (acquiring.current || recorder.current?.state === 'recording' || submitting.current) return;
    acquiring.current = true; setPreparing(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!alive.current) { stream.getTracks().forEach(track => track.stop()); return; }
      tracks.current = stream;
      const media = new MediaRecorder(stream); recorder.current = media;
      const parts: BlobPart[] = [];
      media.ondataavailable = event => { if (event.data.size) parts.push(event.data); };
      media.onstop = () => {
        if (recordingTimer.current) clearTimeout(recordingTimer.current);
        stream.getTracks().forEach(track => track.stop()); recorder.current = null;
        if (alive.current) { setRecording(false); void submit(new Blob(parts, { type: media.mimeType })); }
      };
      media.start(); setRecording(true); setError('');
      recordingTimer.current = setTimeout(() => { if (media.state === 'recording') media.stop(); }, 60000);
    } catch {
      tracks.current?.getTracks().forEach(track => track.stop());
      if (alive.current) setError('无法录音，请允许麦克风权限或使用文字输入。');
    } finally { acquiring.current = false; if (alive.current) setPreparing(false); }
  }
  return <section style={{ position: 'absolute', inset: 0, zIndex: 100, background: '#f6f5ef', color: '#222', padding: 24, overflow: 'auto' }}>
    <h2>夜阑通话</h2>
    <select aria-label="通话角色" value={characterId} disabled={busy || recording || preparing} onChange={e => { void closeSession(); setCharacterId(e.target.value); }}>
      {characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
    </select>
    <select aria-label="通话方式" value={kind} disabled={busy || recording || preparing} onChange={e => { void closeSession(); setKind(e.target.value as typeof kind); }}>
      <option value="voice">普通通话</option><option value="voice-hq">高质量通话</option>
    </select>
    <p>继续当前聊天，通话记录会回到这个聊天窗口。</p>
    <button disabled={busy || preparing} onClick={() => recording ? recorder.current?.stop() : void startRecording()}>{preparing ? '正在打开麦克风…' : recording ? '结束录音并发送' : '开始录音（最长 60 秒）'}</button>
    {kind === 'voice' && <div><textarea aria-label="文字说话" value={text} onChange={e => setText(e.target.value)} maxLength={4000} /><button disabled={busy || recording || preparing || !text.trim()} onClick={() => void submit()}>发送文字，听语音回复</button></div>}
    {busy && <p role="status">正在等待回复…</p>}
    {error && <p role="alert">{error}</p>}
    {transcript && <p>{transcript}</p>}
    {audioUrl && <audio controls autoPlay src={audioUrl} />}
    <p><button onClick={onEnd}>结束通话</button></p>
  </section>;
}
