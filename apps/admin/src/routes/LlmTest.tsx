import { useEffect, useState } from 'react';
import { Cpu, Circle, TestTube2 } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

type Protocol = 'openai-compatible' | 'anthropic' | 'nvidia';

interface ApiEntry {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  enabled: boolean;
  ready: boolean;
}

interface Draft {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  enabled: boolean;
}

const emptyDraft: Draft = {
  id: '',
  name: '',
  protocol: 'openai-compatible',
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  apiKey: '',
  enabled: true,
};

const protocolDefaults: Record<Protocol, { baseUrl: string; model: string }> = {
  'openai-compatible': { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com', model: 'claude-sonnet-4-6' },
  nvidia: { baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'z-ai/glm-5.1' },
};

export function LlmTest() {
  const { error: toastErr } = useToast();
  const [entries, setEntries] = useState<ApiEntry[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [testing, setTesting] = useState(false);
  const [testOutput, setTestOutput] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const data = await api.get<{ entries: ApiEntry[] }>('/api/admin/llm-apis');
        setEntries(data.entries);
        if (data.entries[0]) {
          const e = data.entries[0];
          setDraft({ id: e.id, name: e.name, protocol: e.protocol, baseUrl: e.baseUrl, model: e.model, apiKey: '', enabled: e.enabled });
        }
      } catch (e) {
        setErr((e as Error).message);
        toastErr('加载 API 列表失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function updateDraft(patch: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function changeProtocol(protocol: Protocol) {
    const defaults = protocolDefaults[protocol];
    setDraft((prev) => ({ ...prev, protocol, baseUrl: defaults.baseUrl, model: prev.model || defaults.model }));
  }

  async function testDraft() {
    if (!draft.apiKey) { toastErr('请先填入 API Key'); return; }
    setTesting(true);
    setTestOutput('testing...');
    try {
      const data = await api.post<{ ok: boolean; latencyMs?: number; sample?: string; error?: string }>('/api/admin/llm-apis/test', draft);
      setTestOutput(data.ok ? `OK ${data.latencyMs ?? 0}ms\n${data.sample ?? ''}` : `FAILED\n${data.error ?? 'unknown error'}`);
    } catch (e) {
      setTestOutput(`FAILED\n${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  }

  if (loading) {
    return <div className="state-placeholder"><Cpu size={32} /><span>加载 API 列表...</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>LLM 测试</h2>
      <p style={{ color: 'var(--paper-dim)', marginBottom: 16, fontSize: 14 }}>
        测试 LLM provider 是否可用，定位 key、模型名或网络问题。
      </p>

      <div className="card">
        <h3>已注册 API</h3>
        <table>
          <thead>
            <tr><th>名称</th><th>协议</th><th>模型</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.name}</td>
                <td>{entry.protocol}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{entry.model}</td>
                <td><span className={`badge ${entry.ready ? 'badge-ok' : 'badge-warn'}`}>{entry.ready ? 'ready' : 'absent'}</span></td>
                <td>
                  <button className="btn btn-sm" onClick={() => setDraft({ id: entry.id, name: entry.name, protocol: entry.protocol, baseUrl: entry.baseUrl, model: entry.model, apiKey: '', enabled: entry.enabled })}>
                    填入下方
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>测试参数</h3>
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))' }}>
          <div className="field">
            <label>名称</label>
            <input value={draft.name} onChange={(e) => updateDraft({ name: e.target.value })} placeholder="DeepSeek" />
          </div>
          <div className="field">
            <label>协议</label>
            <select value={draft.protocol} onChange={(e) => changeProtocol(e.target.value as Protocol)}>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="nvidia">NVIDIA</option>
            </select>
          </div>
          <div className="field">
            <label>模型</label>
            <input value={draft.model} onChange={(e) => updateDraft({ model: e.target.value })} />
          </div>
        </div>
        <div className="field">
          <label>Base URL</label>
          <input value={draft.baseUrl} onChange={(e) => updateDraft({ baseUrl: e.target.value })} />
        </div>
        <div className="field">
          <label>API Key</label>
          <input type="password" value={draft.apiKey} onChange={(e) => updateDraft({ apiKey: e.target.value })} placeholder="sk-..." />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={testDraft} disabled={testing}>
            <TestTube2 size={14} /> {testing ? '测试中...' : '测试'}
          </button>
          <button className="btn" onClick={() => setDraft(emptyDraft)}>清空</button>
        </div>
        {testOutput && <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', color: 'var(--paper-dim)' }}>{testOutput}</pre>}
      </div>
    </div>
  );
}
