import { useEffect, useState } from 'react';
import { Circle, MessageSquare, Send } from 'lucide-react';
import { DEFAULT_USER_BOUNDARY } from '@yelan/shared';
import { api, getAuthHeaders, getBase } from '../api/client';
import { useToast } from '../components/Toast';

interface CharacterOption {
  id: string;
  name: string;
  boundaryDefault?: 1 | 2 | 3 | 4 | 5;
}

type Stage = 'daily' | 'rise' | 'climax' | 'after' | 'end';

export function ChatTest() {
  const { success, error: toastErr } = useToast();
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [characterId, setCharacterId] = useState('');
  const [boundary, setBoundary] = useState<1 | 2 | 3 | 4 | 5>(DEFAULT_USER_BOUNDARY);
  const [stage, setStage] = useState<Stage>('daily');
  const [round, setRound] = useState(1);
  const [text, setText] = useState('今晚你在想什么？');
  const [output, setOutput] = useState('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const data = await api.get<{ characters: CharacterOption[] }>('/api/admin/characters');
        if (cancelled) return;
        setCharacters(data.characters);
        const first = data.characters[0];
        if (first) {
          setCharacterId(first.id);
          setBoundary(first.boundaryDefault ?? DEFAULT_USER_BOUNDARY);
        }
      } catch (e) {
        if (cancelled) return;
        setErr((e as Error).message);
        toastErr('加载角色失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function runChatTest() {
    if (!characterId || !text.trim()) return;
    setRunning(true);
    setOutput('创建测试会话...\n');
    try {
      const headers = {
        'Content-Type': 'application/json',
        ...getAuthHeaders(),
      };

      const sessionRes = await fetch(`${getBase()}/api/sessions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ characterId, mode: 'main' }),
      });
      if (!sessionRes.ok) throw new Error(`session ${sessionRes.status}`);
      const session = await sessionRes.json() as { id: string };

      const payload = {
        characterId,
        sessionId: session.id,
        round,
        prevStage: stage,
        userBoundary: boundary,
        text: text.trim(),
        history: [],
      };

      setOutput(`session: ${session.id}\n等待响应...\n\n`);
      const res = await fetch(`${getBase()}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) throw new Error(`chat ${res.status}`);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let raw = '';
      const meta: string[] = [];
      const render = () => {
        setOutput([
          `session: ${session.id}`,
          meta.join('\n'),
          '',
          raw || '(尚无文本)',
        ].filter(Boolean).join('\n'));
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() ?? '';
        for (const block of blocks) {
          const data = block.split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trim())
            .join('');
          if (!data) continue;
          const ev = JSON.parse(data) as {
            kind: string;
            stage?: string;
            boundary?: number;
            temperature?: number;
            text?: string;
            rawText?: string;
            reason?: string;
            code?: string;
            message?: string;
          };
          if (ev.kind === 'meta') meta.push(`meta: stage=${ev.stage} boundary=${ev.boundary}`);
          else if (ev.kind === 'atmosphere') meta.push(`temperature: ${ev.temperature}`);
          else if (ev.kind === 'chunk') raw += ev.text ?? '';
          else if (ev.kind === 'structured' && !raw) raw = ev.rawText ?? '';
          else if (ev.kind === 'cutoff') meta.push(`cutoff: ${ev.reason}`);
          else if (ev.kind === 'error') meta.push(`error: ${ev.code} ${ev.message}`);
          render();
        }
      }
      success('对话测试完成');
    } catch (e) {
      const message = (e as Error).message;
      setOutput((prev) => `${prev}\nERROR: ${message}`);
      toastErr(message);
    } finally {
      setRunning(false);
    }
  }

  if (loading) return <div className="state-placeholder"><MessageSquare size={32} /><span>加载对话测试...</span></div>;
  if (err) return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;

  return (
    <div>
      <h2>对话测试</h2>

      <div className="card">
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(4, minmax(160px, 1fr))' }}>
          <div className="field">
            <label>角色</label>
            <select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
              {characters.map((character) => (
                <option key={character.id} value={character.id}>{character.name} · {character.id}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>boundary</label>
            <select value={boundary} onChange={(e) => setBoundary(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="field">
            <label>prevStage</label>
            <select value={stage} onChange={(e) => setStage(e.target.value as Stage)}>
              {['daily', 'rise', 'climax', 'after', 'end'].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div className="field">
            <label>round</label>
            <input type="number" min={0} value={round} onChange={(e) => setRound(Number(e.target.value))} />
          </div>
        </div>

        <div className="field">
          <label>测试输入</label>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} />
        </div>

        <button className="btn btn-primary" onClick={runChatTest} disabled={running || !characterId || !text.trim()}>
          <Send size={14} /> {running ? '发送中...' : '发送测试对话'}
        </button>
      </div>

      <div className="card">
        <h3>输出</h3>
        <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', minHeight: 220, color: 'var(--paper)' }}>
          {output || '还没有测试输出。'}
        </pre>
      </div>
    </div>
  );
}
