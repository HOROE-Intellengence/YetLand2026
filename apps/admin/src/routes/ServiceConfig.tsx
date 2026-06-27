import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { Circle, Database, RefreshCw, Save, TestTube2, Trash2 } from 'lucide-react';
import { DEFAULT_GLOBAL_BOUNDARY } from '@yelan/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

type Protocol = 'openai-compatible' | 'anthropic' | 'nvidia';
type SidecarTaskKey = 'outputStructurer' | 'preferenceRecorder' | 'quotaEnding' | 'contextCompressor';
type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

const reasoningOptions: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

interface ApiEntry {
  id: string;
  name: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  apiKey: string;
  maskedKey: string;
  enabled: boolean;
  ready: boolean;
  updatedAt: string;
}

interface InventoryResponse {
  entries: ApiEntry[];
  mainApiId: string | null;
  sidecarApiId: string | null;
  sidecarTaskApiIds: Partial<Record<SidecarTaskKey, string | null>>;
  mainReasoningEffort: ReasoningEffort;
  mainReasoningEffortCipher: ReasoningEffort;
}

interface ReloadConfigResponse {
  envApplied?: number;
  flagChanges?: Array<{ flag: string; from: boolean; to: boolean }>;
  readyProviders?: string[];
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

const sidecarTaskLabels: Record<SidecarTaskKey, string> = {
  outputStructurer: '分句侧袋',
  preferenceRecorder: '偏好记录',
  quotaEnding: '额度收尾',
  contextCompressor: '上下文压缩',
};

const sidecarTaskKeys = Object.keys(sidecarTaskLabels) as SidecarTaskKey[];

function draftFromEntry(entry: ApiEntry): Draft {
  return {
    id: entry.id,
    name: entry.name,
    protocol: entry.protocol,
    baseUrl: entry.baseUrl,
    model: entry.model,
    apiKey: '',
    enabled: entry.enabled,
  };
}

export function ServiceConfig() {
  const { success, error: toastErr } = useToast();
  const [inventory, setInventory] = useState<InventoryResponse | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [isNewDraft, setIsNewDraft] = useState(false);
  const [reason, setReason] = useState('');
  const [testing, setTesting] = useState('');
  const [testOutput, setTestOutput] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [showQuickFill, setShowQuickFill] = useState(false);

  // ── Env + runtime config ────────────────────────────────────────────
  type EnvGroup = Record<string, Array<{ key: string; value: string; present: boolean; secret: boolean }>>;
  type RuntimeConfig = { narrativeBoundaryGlobal: number; mockLatencyMs: number; freeLimitOverride: number | null };
  const [envGroups, setEnvGroups] = useState<EnvGroup>({});
  const [runtime, setRuntime] = useState<RuntimeConfig>({ narrativeBoundaryGlobal: DEFAULT_GLOBAL_BOUNDARY, mockLatencyMs: 120, freeLimitOverride: null });
  const [configReason, setConfigReason] = useState('');
  const [configSaving, setConfigSaving] = useState(false);
  const [configReloading, setConfigReloading] = useState(false);
  const [envEdit, setEnvEdit] = useState<Record<string, string>>({});

  async function loadConfig() {
    try {
      const data = await api.get<{ env: EnvGroup; runtime: { narrativeBoundaryGlobal: number; mockLatencyMs: number; freeLimitOverride: number | null } }>('/api/admin/config');
      setEnvGroups(data.env);
      setRuntime(data.runtime);
    } catch { /* ignore */ }
  }

  useEffect(() => { loadConfig(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const entries = inventory?.entries ?? [];
  const selectedMain = useMemo(() => entries.find((entry) => entry.id === inventory?.mainApiId), [entries, inventory]);
  const selectedSidecar = useMemo(() => entries.find((entry) => entry.id === inventory?.sidecarApiId), [entries, inventory]);
  const taskApiNames = useMemo(() => {
    const result: Partial<Record<SidecarTaskKey, string>> = {};
    for (const key of sidecarTaskKeys) {
      const id = inventory?.sidecarTaskApiIds?.[key];
      result[key] = entries.find((entry) => entry.id === id)?.name ?? selectedSidecar?.name ?? '-';
    }
    return result;
  }, [entries, inventory, selectedSidecar]);

  async function load() {
    try {
      const data = await api.get<InventoryResponse>('/api/admin/llm-apis');
      setInventory(data);
      // 仅首次加载且用户尚未主动操作时自动选中第一条；若用户在新建模式则不干扰
      if (!isNewDraft && !draft.id && data.entries[0]) setDraft(draftFromEntry(data.entries[0]));
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载 API 仓库失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function updateDraft(patch: Partial<Draft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function changeProtocol(protocol: Protocol) {
    const defaults = protocolDefaults[protocol];
    setDraft((prev) => ({ ...prev, protocol, baseUrl: defaults.baseUrl, model: prev.model || defaults.model }));
  }

  async function saveEntry() {
    if (!draft.name.trim() || !draft.model.trim() || !reason.trim()) {
      toastErr('名称、模型、原因必填');
      return;
    }
    setSaving(true);
    try {
      await api.post('/api/admin/llm-apis', {
        ...draft,
        id: draft.id.trim() || undefined,
        reason: reason.trim(),
      });
      success('API 库存已保存');
      setReason('');
      setIsNewDraft(false);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function select(role: 'main' | 'sidecar', id: string) {
    if (!reason.trim()) {
      toastErr('切换前先填原因');
      return;
    }
    try {
      await api.post('/api/admin/llm-apis/select', { role, id, reason: reason.trim() });
      success(role === 'main' ? '主模型 API 已切换' : '侧袋 API 已切换');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function selectTask(taskKey: SidecarTaskKey, id: string | null) {
    if (!reason.trim()) {
      toastErr('切换前先填写原因');
      return;
    }
    try {
      await api.post('/api/admin/llm-apis/select-task', { taskKey, id, reason: reason.trim() });
      success(`${sidecarTaskLabels[taskKey]}渠道已更新`);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function setReasoningEffort(scenario: 'normal' | 'cipher', effort: ReasoningEffort) {
    if (!reason.trim()) {
      toastErr('调整推理档位前先填原因');
      return;
    }
    try {
      await api.post('/api/admin/llm-apis/reasoning-effort', { scenario, effort, reason: reason.trim() });
      success(scenario === 'cipher' ? '暗号场景推理档位已更新' : '普通场景推理档位已更新');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function remove(id: string) {
    if (!reason.trim()) {
      toastErr('删除前先填原因');
      return;
    }
    if (!window.confirm(`删除 API 库存 ${id}？`)) return;
    try {
      await api.delete(`/api/admin/llm-apis/${encodeURIComponent(id)}?reason=${encodeURIComponent(reason.trim())}`);
      success('API 库存已删除');
      await load();
      setIsNewDraft(false);
      setDraft(emptyDraft);
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function testDraft() {
    setTesting(draft.id || 'draft');
    setTestOutput('testing...');
    try {
      const data = await api.post<{ ok: boolean; latencyMs?: number; sample?: string; error?: string }>('/api/admin/llm-apis/test', draft);
      setTestOutput(data.ok ? `OK ${data.latencyMs ?? 0}ms\n${data.sample ?? ''}` : `FAILED\n${data.error ?? 'unknown error'}`);
    } catch (e) {
      setTestOutput(`FAILED\n${(e as Error).message}`);
    } finally {
      setTesting('');
    }
  }

  async function reloadConfig() {
    setConfigReloading(true);
    try {
      const r = await api.post<ReloadConfigResponse>('/api/admin/diagnostics/reload-config');
      const changes = r.flagChanges ?? [];
      const flagSummary = changes.length
        ? changes.map((x) => `${x.flag} ${x.from ? 'on' : 'off'}→${x.to ? 'on' : 'off'}`).join('、')
        : '无 flag 变更';
      success(`配置已重载 · ${flagSummary} · ${r.envApplied ?? 0} env 更新 · ${r.readyProviders?.length ?? 0} provider ready`);
      await Promise.all([loadConfig(), load()]);
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setConfigReloading(false);
    }
  }

  if (loading) return <div className="state-placeholder"><Database size={32} /><span>加载 API 仓库...</span></div>;
  if (err) return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>API 仓库</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <button
            className="btn"
            onClick={reloadConfig}
            disabled={configReloading}
            title="重新读取 .env、清 flag 缓存并重建 LLM router"
          >
            <RefreshCw size={14} /> {configReloading ? '重载中...' : '重载配置'}
          </button>
          <span className="pill">主: {selectedMain?.name ?? '-'} / 侧袋: {selectedSidecar?.name ?? '-'}</span>
        </div>
      </div>

      <div className="card">
        <h3>库存</h3>
        <table>
          <thead>
            <tr><th>名称</th><th>协议</th><th>模型</th><th>Key</th><th>状态</th><th>用途</th><th>操作</th></tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td><button className="btn btn-sm" onClick={() => { setIsNewDraft(false); setDraft(draftFromEntry(entry)); }}>{entry.name}</button></td>
                <td>{entry.protocol}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{entry.model}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{entry.maskedKey || '-'}</td>
                <td><span className={`badge ${entry.ready ? 'badge-ok' : 'badge-warn'}`}>{entry.ready ? 'ready' : 'absent'}</span></td>
                <td>
                  {inventory?.mainApiId === entry.id && <span className="badge badge-ok" style={{ marginRight: 6 }}>主</span>}
                  {inventory?.sidecarApiId === entry.id && <span className="badge badge-warn" style={{ marginRight: 6 }}>侧袋</span>}
                  {sidecarTaskKeys
                    .filter((key) => inventory?.sidecarTaskApiIds?.[key] === entry.id)
                    .map((key) => (
                      <span key={key} className="badge" style={{ marginRight: 6 }}>{sidecarTaskLabels[key]}</span>
                    ))}
                </td>
                <td>
                  <button className="btn btn-sm" onClick={() => select('main', entry.id)} style={{ marginRight: 6 }}>设主</button>
                  <button className="btn btn-sm" onClick={() => select('sidecar', entry.id)} style={{ marginRight: 6 }}>设侧袋</button>
                  <button className="btn btn-sm btn-danger" onClick={() => remove(entry.id)}><Trash2 size={12} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>侧袋任务渠道</h3>
        <p style={{ fontSize: 12, color: 'var(--paper-dim)', marginBottom: 12 }}>
          只给偏好记录、额度收尾、上下文压缩指定独立 key；温度 AI 和拆句 AI 继续使用普通侧袋渠道。
        </p>
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))' }}>
          {sidecarTaskKeys.map((taskKey) => (
            <div className="field" key={taskKey}>
              <label>{sidecarTaskLabels[taskKey]}</label>
              <select
                value={inventory?.sidecarTaskApiIds?.[taskKey] ?? ''}
                onChange={(e) => selectTask(taskKey, e.target.value || null)}
              >
                <option value="">跟随普通侧袋：{selectedSidecar?.name ?? '-'}</option>
                {entries.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.name}{entry.ready ? '' : '（未就绪）'}
                  </option>
                ))}
              </select>
              <span className="pill" style={{ marginTop: 6 }}>当前：{taskApiNames[taskKey]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>主 AI 推理档位 (reasoning_effort)</h3>
        <p style={{ fontSize: 12, color: 'var(--paper-dim)', marginBottom: 12 }}>
          仅对支持的模型族生效（Gemini 3.x / gpt-5 / o 系列）。flash-lite 不传 ≈ minimal。
          普通场景默认 low；暗号(IF 解锁)场景可单独分档。调整前请在下方填写变更原因。
        </p>
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(2, minmax(200px, 1fr))' }}>
          <div className="field">
            <label>普通场景</label>
            <select
              value={inventory?.mainReasoningEffort ?? 'low'}
              onChange={(e) => setReasoningEffort('normal', e.target.value as ReasoningEffort)}
            >
              {reasoningOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            <span className="pill" style={{ marginTop: 6 }}>当前：{inventory?.mainReasoningEffort ?? 'low'}</span>
          </div>
          <div className="field">
            <label>暗号场景 (IF 解锁)</label>
            <select
              value={inventory?.mainReasoningEffortCipher ?? 'low'}
              onChange={(e) => setReasoningEffort('cipher', e.target.value as ReasoningEffort)}
            >
              {reasoningOptions.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
            <span className="pill" style={{ marginTop: 6 }}>当前：{inventory?.mainReasoningEffortCipher ?? 'low'}</span>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
          <h3 style={{ margin: 0 }}>{draft.id ? `编辑 ${draft.id}` : '新增 API'}</h3>
          {entries.length > 0 && (
            <button className="btn btn-sm" onClick={() => setShowQuickFill((v) => !v)}>
              快速填写 {showQuickFill ? '▲' : '▼'}
            </button>
          )}
        </div>
        {showQuickFill && entries.length > 0 && (() => {
          const urls = [...new Set(entries.map((e) => e.baseUrl))];
          const models = [...new Set(entries.map((e) => e.model))];
          const pill: CSSProperties = { cursor: 'pointer', padding: '2px 8px', borderRadius: 4, fontSize: 11, background: 'var(--surface-2, #2a2a2a)', border: '1px solid var(--border, #444)', fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap' };
          const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 };
          return (
            <div style={{ background: 'var(--surface-1, #1e1e1e)', border: '1px solid var(--border, #444)', borderRadius: 6, padding: '8px 10px', marginBottom: 12 }}>
              <div style={row}>
                <span style={{ fontSize: 11, color: 'var(--paper-dim)', minWidth: 36 }}>整条</span>
                {entries.map((en) => (
                  <button key={en.id} className="btn btn-sm" style={pill} onClick={() => { updateDraft({ protocol: en.protocol, baseUrl: en.baseUrl, model: en.model }); setShowQuickFill(false); }}>
                    {en.name} — {en.model}
                  </button>
                ))}
              </div>
              <div style={row}>
                <span style={{ fontSize: 11, color: 'var(--paper-dim)', minWidth: 36 }}>URL</span>
                {urls.map((u) => (
                  <button key={u} className="btn btn-sm" style={pill} onClick={() => { updateDraft({ baseUrl: u }); setShowQuickFill(false); }}>
                    {u}
                  </button>
                ))}
              </div>
              <div style={{ ...row, marginBottom: 0 }}>
                <span style={{ fontSize: 11, color: 'var(--paper-dim)', minWidth: 36 }}>模型</span>
                {models.map((m) => (
                  <button key={m} className="btn btn-sm" style={pill} onClick={() => { updateDraft({ model: m }); setShowQuickFill(false); }}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
          );
        })()}
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(180px, 1fr))' }}>
          <div className="field">
            <label>ID</label>
            <input value={draft.id} onChange={(e) => updateDraft({ id: e.target.value })} placeholder="custom-deepseek-1" />
          </div>
          <div className="field">
            <label>名称</label>
            <input value={draft.name} onChange={(e) => updateDraft({ name: e.target.value })} placeholder="DeepSeek 备用 key" />
          </div>
          <div className="field">
            <label>协议</label>
            <select value={draft.protocol} onChange={(e) => changeProtocol(e.target.value as Protocol)}>
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="nvidia">NVIDIA</option>
            </select>
          </div>
        </div>
        <div className="metrics" style={{ gridTemplateColumns: '2fr 1.4fr 1fr' }}>
          <div className="field">
            <label>Base URL</label>
            <input value={draft.baseUrl} onChange={(e) => updateDraft({ baseUrl: e.target.value })} />
          </div>
          <div className="field">
            <label>模型</label>
            <input value={draft.model} onChange={(e) => updateDraft({ model: e.target.value })} />
          </div>
          <div className="field">
            <label>启用</label>
            <select value={draft.enabled ? '1' : '0'} onChange={(e) => updateDraft({ enabled: e.target.value === '1' })}>
              <option value="1">启用</option>
              <option value="0">停用</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label>API Key</label>
          <input type="password" value={draft.apiKey} onChange={(e) => updateDraft({ apiKey: e.target.value })} placeholder="留空则保留旧 key" />
        </div>
        <div className="field">
          <label>变更原因</label>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：新增备用供应商 / 切换侧袋模型" />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-primary" onClick={saveEntry} disabled={saving}><Save size={14} /> {saving ? '保存中...' : '保存 API'}</button>
          <button className="btn" onClick={testDraft} disabled={!!testing || !draft.apiKey}><TestTube2 size={14} /> {testing ? '测试中...' : '测试当前草稿'}</button>
          <button className="btn" onClick={() => { setIsNewDraft(true); setDraft(emptyDraft); }}>新建</button>
        </div>
        {testOutput && <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', color: 'var(--paper-dim)' }}>{testOutput}</pre>}
      </div>

      {/* ── Env 编辑 ──────────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>.env 变量</h3>
        <p style={{ fontSize: 12, color: 'var(--paper-dim)', marginBottom: 12 }}>
          修改后即时生效（写入 apps/api/.env 并重置 LLM router）。密钥类仅显示脱敏值。
        </p>
        {Object.entries(envGroups).map(([group, keys]) => (
          <div key={group} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--gold-light)', marginBottom: 6, textTransform: 'uppercase' }}>{group}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 3fr 60px', gap: '6px 10px', alignItems: 'center' }}>
              {keys.map((k) => (
                <>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={k.key}>{k.key}</span>
                  <input
                    type={k.secret ? 'password' : 'text'}
                    value={envEdit[k.key] ?? k.value}
                    onChange={(e) => setEnvEdit((prev) => ({ ...prev, [k.key]: e.target.value }))}
                    placeholder={k.present ? '已配置（脱敏）' : '未配置'}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}
                  />
                  <span className={`badge ${k.present ? 'badge-ok' : 'badge-warn'}`} style={{ fontSize: 9 }}>{k.present ? 'set' : '--'}</span>
                </>
              ))}
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>变更原因</label>
            <input value={configReason} onChange={(e) => setConfigReason(e.target.value)} placeholder="修改了哪些 key？" />
          </div>
          <button
            className="btn btn-primary"
            disabled={configSaving || !configReason.trim() || Object.keys(envEdit).length === 0}
            onClick={async () => {
              if (!configReason.trim()) { toastErr('请填写变更原因'); return; }
              setConfigSaving(true);
              try {
                await api.post('/api/admin/config/env', { patch: envEdit, reason: configReason.trim() });
                success('Env 已更新');
                setConfigReason('');
                setEnvEdit({});
                await loadConfig();
                await load();
              } catch (e) { toastErr((e as Error).message); }
              finally { setConfigSaving(false); }
            }}
          >
            <Save size={14} /> {configSaving ? '保存中...' : '保存 Env'}
          </button>
        </div>
      </div>

      {/* ── Runtime 覆盖 ──────────────────────────────────────────── */}
      <div className="card" style={{ marginTop: 16 }}>
        <h3>运行期覆盖</h3>
        <p style={{ fontSize: 12, color: 'var(--paper-dim)', marginBottom: 12 }}>
          即时生效，不写 .env。适合快速调参试效果。
        </p>
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 12 }}>
          <div className="field">
            <label>全局合规边界 (1-5)</label>
            <select value={runtime.narrativeBoundaryGlobal} onChange={(e) => setRuntime((prev) => ({ ...prev, narrativeBoundaryGlobal: Number(e.target.value) }))}>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>B{n}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Mock 延迟 (ms)</label>
            <input type="number" value={runtime.mockLatencyMs} onChange={(e) => setRuntime((prev) => ({ ...prev, mockLatencyMs: Number(e.target.value) }))} />
          </div>
          <div className="field">
            <label>免费限额覆盖</label>
            <input
              type="number"
              value={runtime.freeLimitOverride ?? ''}
              onChange={(e) => setRuntime((prev) => ({ ...prev, freeLimitOverride: e.target.value ? Number(e.target.value) : null }))}
              placeholder="留空=默认"
            />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label>变更原因</label>
            <input value={configReason} onChange={(e) => setConfigReason(e.target.value)} placeholder="为什么调这些参数？" />
          </div>
          <button
            className="btn btn-primary"
            disabled={configSaving || !configReason.trim()}
            onClick={async () => {
              if (!configReason.trim()) { toastErr('请填写变更原因'); return; }
              setConfigSaving(true);
              try {
                await api.post('/api/admin/config/runtime', {
                  narrativeBoundaryGlobal: runtime.narrativeBoundaryGlobal,
                  mockLatencyMs: runtime.mockLatencyMs,
                  freeLimitOverride: runtime.freeLimitOverride,
                  reason: configReason.trim(),
                });
                success('运行期参数已更新');
                setConfigReason('');
                await loadConfig();
              } catch (e) { toastErr((e as Error).message); }
              finally { setConfigSaving(false); }
            }}
          >
            <Save size={14} /> {configSaving ? '应用...' : '应用覆盖'}
          </button>
        </div>
      </div>
    </div>
  );
}
