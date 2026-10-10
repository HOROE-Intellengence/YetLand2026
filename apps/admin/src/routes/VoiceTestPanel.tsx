import { useEffect, useRef, useState } from 'react';
import type { VoiceDiagnosticResult } from '@yelan/shared';
import { api, getAuthHeaders, getBase } from '../api/client';

export function VoiceTestPanel({ onComplete }: { onComplete: () => void }) {
  const [users, setUsers] = useState<
    { id: string; name?: string; email?: string; phone?: string }[]
  >([]);
  const [characters, setCharacters] = useState<{ id: string; name: string; isActive: boolean }[]>(
    [],
  );
  const [userId, setUserId] = useState(''),
    [characterId, setCharacterId] = useState('');
  const [mode, setMode] = useState<'instant' | 'advanced'>('advanced');
  const [text, setText] = useState('夜深了，不用着急，我会在这里陪着你。');
  const [result, setResult] = useState<VoiceDiagnosticResult | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [audio, setAudio] = useState('');
  const active = useRef(true),
    lock = useRef(false),
    controller = useRef<AbortController | null>(null);
  const pending = useRef<{
    mode: 'instant' | 'advanced';
    userId: string;
    characterId: string;
    text: string;
    requestId: string;
  } | null>(null);
  const audioUrl = useRef(''),
    pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const complete = useRef(onComplete);
  complete.current = onComplete;
  useEffect(() => {
    active.current = true;
    Promise.all([
      api.get<typeof users>('/api/admin/users?guest=0&limit=500'),
      api.get<{ characters: typeof characters }>('/api/admin/characters'),
    ])
      .then(([users, data]) => {
        if (!active.current) return;
        setUsers(users);
        setCharacters(data.characters.filter((c) => c.isActive));
      })
      .catch((e) => {
        if (active.current) setError((e as Error).message);
      });
    return () => {
      active.current = false;
      controller.current?.abort();
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, []);
  const read = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const response = await fetch(`${getBase()}/api/admin/voice${path}`, {
      ...init,
      headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
      signal: controller.current?.signal,
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.message || body.code || `请求失败：${response.status}`);
    return body as T;
  };
  async function start() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = '';
    setAudio('');
    const abort = new AbortController();
    controller.current = abort;
    pending.current ??= {
      mode,
      userId,
      characterId,
      text: text.trim(),
      requestId: crypto.randomUUID(),
    };
    const started = Date.now();
    const finish = () => {
      lock.current = false;
      if (active.current) setBusy(false);
    };
    async function update(value: VoiceDiagnosticResult) {
      if (!active.current || abort.signal.aborted) return;
      setResult(value);
      if (value.status === 'processing') {
        if (Date.now() - started > 190000) {
          setError('等待超时，测试仍保留在服务器。请点击“查询原测试”，不会重新生成。');
          finish();
          return;
        }
        pollTimer.current = setTimeout(() => {
          read<VoiceDiagnosticResult>(`/tests/${encodeURIComponent(value.id)}`)
            .then(update)
            .catch((e) => {
              if (active.current && !abort.signal.aborted) setError((e as Error).message);
              finish();
            });
        }, 1500);
        return;
      }
      complete.current();
      if (value.status !== 'complete' || !value.persistence.audioReadable || !value.outputAudio) {
        setError(`测试未完成：${value.errorCode || value.status}，失败记录已保留。`);
        finish();
        return;
      }
      const response = await fetch(
        `${getBase()}/api/admin/voice/assets/${encodeURIComponent(value.outputAudio.id)}`,
        { headers: getAuthHeaders(), signal: abort.signal },
      );
      if (!response.ok) throw new Error('音频已入库，但读取失败，请检查语音记录。');
      const blob = await response.blob();
      if (active.current && !abort.signal.aborted) {
        audioUrl.current = URL.createObjectURL(blob);
        setAudio(audioUrl.current);
      }
      finish();
    }
    try {
      const value =
        result?.status === 'processing'
          ? await read<VoiceDiagnosticResult>(`/tests/${encodeURIComponent(result.id)}`)
          : await read<VoiceDiagnosticResult>('/tests', {
              method: 'POST',
              body: JSON.stringify(pending.current),
            });
      await update(value);
    } catch (e) {
      if (active.current && !abort.signal.aborted) setError((e as Error).message);
      finish();
    }
  }
  function reset() {
    pending.current = null;
    setResult(null);
    setError('');
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = '';
    setAudio('');
  }
  return (
    <details className="card" style={{ marginBottom: 24 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>通话联通与落库测试</summary>
      <p className="muted">
        调用当前服务器的真实语音上游，可能消耗供应商额度。测试记录会保留在语音库，不写入角色记忆，也不自动获得训练授权。
      </p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: '16px 0' }}>
        <label>
          通话版本
          <select
            disabled={busy}
            value={mode}
            onChange={(e) => {
              reset();
              setMode(e.target.value as typeof mode);
            }}
          >
            <option value="instant">即时通话 · Gemini Live</option>
            <option value="advanced">高级通话 · Fish TTS</option>
          </select>
        </label>
        <label>
          测试归属账号
          <select
            disabled={busy}
            value={userId}
            onChange={(e) => {
              reset();
              setUserId(e.target.value);
            }}
          >
            <option value="">请选择注册用户</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name || u.email || u.phone || u.id}
              </option>
            ))}
          </select>
        </label>
        <label>
          测试角色
          <select
            disabled={busy}
            value={characterId}
            onChange={(e) => {
              reset();
              setCharacterId(e.target.value);
            }}
          >
            <option value="">请选择角色</option>
            {characters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {mode === 'advanced' ? '朗读文字' : '触发语音回复的文字'}
        <textarea
          aria-label="语音联通测试文字"
          disabled={busy}
          value={text}
          maxLength={300}
          onChange={(e) => {
            reset();
            setText(e.target.value);
          }}
          style={{ width: '100%', minHeight: 80, marginTop: 8 }}
        />
      </label>
      <p className="muted">
        {mode === 'advanced'
          ? '高级通话：按角色绑定音色直接合成原文，检查 Fish → Opus 音频文件 → SQLite → 鉴权回读。此项不经过文字主模型与 ASR。'
          : '即时通话：发送文字触发真实 Gemini Live 语音回复，检查中继、生成、音频存储及鉴权回读。此项不包含麦克风上传。'}
      </p>
      <button
        className="btn"
        disabled={busy || !userId || !characterId || !text.trim()}
        onClick={() => void start()}
      >
        {busy
          ? '正在生成并检查落库…'
          : result?.status === 'processing'
            ? '查询原测试'
            : result
              ? '重新检查原测试'
              : pending.current
                ? '恢复原请求'
                : '生成语音并检查落库'}
      </button>
      {result && (
        <button className="btn btn-sm" disabled={busy} onClick={reset} style={{ marginLeft: 12 }}>
          新建测试
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {result && (
        <div role="status" style={{ marginTop: 16 }}>
          <p>
            {result.status === 'complete'
              ? '语音生成成功'
              : result.status === 'processing'
                ? '语音生成中'
                : '测试未完成'}{' '}
            · 轮次入库：{result.persistence.turnSaved ? '是' : '否'} · 音频入库：
            {result.persistence.audioSaved ? '是' : '否'} · 文件回读及校验：
            {result.persistence.audioReadable ? '通过' : '未通过'}
          </p>
          <p className="muted" style={{ overflowWrap: 'anywhere' }}>
            会话：{result.sessionId}
            <br />
            轮次：{result.turnId || '尚未创建'}
          </p>
          {result.outputText && <p>{result.outputText}</p>}
        </div>
      )}
      {audio && (
        <audio
          controls
          src={audio}
          aria-label="联通测试语音播放器"
          style={{ width: '100%', maxWidth: 480 }}
          onError={() => setError('文件回读成功，但浏览器无法播放此音频。')}
        />
      )}
    </details>
  );
}
