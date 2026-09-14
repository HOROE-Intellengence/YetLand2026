import { useEffect, useMemo, useState } from 'react';
import { Circle, FileText, RotateCcw, Send } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../lib/datetime';

type PromptKind = 'boundary' | 'strategy' | 'character' | 'system';

interface PromptSource {
  key: string;
  kind: PromptKind;
  label: string;
  value: string;
  activeVersionId: string | null;
  activeValue: string | null;
  updatedAt: string | null;
}

interface PromptVersion {
  id: string;
  key: string;
  value: string;
  activeAt: string | null;
  createdAt: string;
}

const kindLabel: Record<PromptKind, string> = {
  boundary: '破甲',
  strategy: '策略',
  character: '角色',
  system: '系统',
};

export function Prompts() {
  const { success, error: toastErr } = useToast();
  const [sources, setSources] = useState<PromptSource[]>([]);
  const [versions, setVersions] = useState<PromptVersion[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const selected = useMemo(
    () => sources.find((source) => source.key === selectedKey) ?? null,
    [selectedKey, sources],
  );

  const selectedVersions = useMemo(
    () => versions.filter((version) => version.key === selectedKey),
    [selectedKey, versions],
  );

  async function load() {
    try {
      const [sourceData, versionData] = await Promise.all([
        api.get<{ sources: PromptSource[] }>('/api/admin/prompts/sources'),
        api.get<PromptVersion[]>('/api/admin/prompts/versions'),
      ]);
      setSources(sourceData.sources);
      setVersions(versionData);
      setSelectedKey((prev) => prev || sourceData.sources.find((s) => s.kind === 'boundary')?.key || sourceData.sources[0]?.key || '');
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载系统提示失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!selected) return;
    setValue(selected.activeValue ?? selected.value);
  }, [selected]);

  async function release() {
    if (!selectedKey || !value.trim() || !reason.trim()) return;
    setSaving(true);
    try {
      const res = await api.post<{ ok: boolean; warning?: string }>('/api/admin/prompts/release', {
        key: selectedKey,
        value,
        reason,
      });
      if (res.warning) toastErr(res.warning);
      else success('已发布，下一轮对话生效');
      setReason('');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function rollback(version: PromptVersion) {
    const why = window.prompt(`回滚/激活 ${version.id} 的原因`, '恢复历史版本');
    if (!why) return;
    try {
      await api.post('/api/admin/prompts/rollback', {
        key: version.key,
        versionId: version.id,
        reason: why,
      });
      success('Prompt 已回滚');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  if (loading) return <div className="state-placeholder"><FileText size={32} /><span>加载系统提示...</span></div>;
  if (err) return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>系统提示编辑器</h2>
        <span className="pill">{sources.length} 段</span>
      </div>

      <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--accent, #7c9)' }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.7 }}>
          编辑主 AI 系统提示的各段：<b>系统模板 / 边界条款 B1–B5 / 阶段策略 / 角色卡</b>。
          发布后 <b>下一轮对话即生效</b>（缺省回退代码内文件），可保留历史版本随时回滚。
          改系统模板若漏掉必需槽位或全局约束，发布仍成功但会返回告警。
        </p>
      </div>

      <div className="card">
        <div className="field">
          <label>Prompt 源</label>
          <select value={selectedKey} onChange={(e) => setSelectedKey(e.target.value)}>
            {sources.map((source) => (
              <option key={source.key} value={source.key}>
                [{kindLabel[source.kind]}] {source.label} - {source.key}
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, minmax(160px, 1fr))' }}>
            <div className="metric">
              <div className="metric-label">当前源</div>
              <div className="metric-value" style={{ fontSize: 14 }}>{selected.label}</div>
            </div>
            <div className="metric">
              <div className="metric-label">类型</div>
              <div className="metric-value" style={{ fontSize: 14 }}>{kindLabel[selected.kind]}</div>
            </div>
            <div className="metric">
              <div className="metric-label">生效版本</div>
              <div className="metric-value" style={{ fontSize: 14 }}>{selected.activeVersionId ?? '原始内容'}</div>
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div className="card">
            <h3>原始内容</h3>
            <textarea
              readOnly
              value={selected.value}
              style={{ width: '100%', minHeight: 360, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>

          <div className="card">
            <h3>发布内容</h3>
            <div className="field">
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                style={{ minHeight: 360, fontFamily: 'var(--font-mono)', fontSize: 12 }}
              />
            </div>
            <div className="field">
              <label>变更原因</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="例如：调整 B5 破甲文案" />
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => setValue(selected.value)}>
                <RotateCcw size={14} /> 用原始内容覆盖
              </button>
              <button className="btn btn-primary" onClick={release} disabled={saving || !reason.trim()}>
                <Send size={14} /> {saving ? '发布中...' : '发布并生效'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>ID</th><th>Key</th><th>状态</th><th>创建时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            {selectedVersions.length === 0 ? (
              <tr><td colSpan={5} style={{ color: 'var(--paper-mute)' }}>暂无发布版本，当前使用左侧原始内容（代码内文件）。</td></tr>
            ) : selectedVersions.map((version) => (
              <tr key={version.id}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{version.id}</td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{version.key}</td>
                <td>
                  <span className={`badge ${version.activeAt ? 'badge-ok' : 'badge-warn'}`}>
                    {version.activeAt ? '生效中' : '未生效'}
                  </span>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{formatDateTime(version.createdAt)}</td>
                <td>
                  {!version.activeAt && (
                    <button className="btn btn-sm" onClick={() => rollback(version)}>激活</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
