import { useState } from 'react';
import { AlertTriangle, CheckCircle, Upload } from 'lucide-react';
import {
  AdminCharacterImportPreviewResponseSchema,
  type AdminCharacterImportCommitResponse,
  type AdminCharacterImportMode,
  type AdminCharacterImportPreviewResponse,
} from '@yelan/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

const MODE_OPTIONS: Array<{ value: AdminCharacterImportMode; label: string }> = [
  { value: 'upsert', label: '自动创建/更新' },
  { value: 'create', label: '只允许新建' },
  { value: 'update', label: '只允许更新' },
];

export function CharacterImportDialog({ onCancel, onImported }: {
  onCancel: () => void;
  onImported: () => Promise<void>;
}) {
  const { success, error: toastErr } = useToast();
  const [raw, setRaw] = useState('');
  const [mode, setMode] = useState<AdminCharacterImportMode>('upsert');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<AdminCharacterImportPreviewResponse | null>(null);
  const [busy, setBusy] = useState(false);

  const handlePreview = async () => {
    setBusy(true);
    try {
      const data = await api.post<AdminCharacterImportPreviewResponse>('/api/admin/characters/import/preview', { raw, mode });
      setPreview(AdminCharacterImportPreviewResponseSchema.parse(data));
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!preview?.canImport || !reason.trim()) return;
    setBusy(true);
    try {
      const data = await api.post<AdminCharacterImportCommitResponse>('/api/admin/characters/import', { raw, mode, reason });
      const verb = data.action === 'update' ? '更新' : '创建';
      success(`角色包已${verb}：${data.imported.name}`);
      await onImported();
      onCancel();
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" style={{ maxWidth: 860, width: 'min(860px, calc(100vw - 48px))' }} onClick={(e) => e.stopPropagation()}>
        <h2>导入角色包</h2>
        <div className="modal-scroll">
          <div className="field">
            <label>导入模式</label>
            <select value={mode} onChange={(e) => { setMode(e.target.value as AdminCharacterImportMode); setPreview(null); }}>
              {MODE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label>粘贴角色包 JSON</label>
            <textarea
              value={raw}
              onChange={(e) => { setRaw(e.target.value); setPreview(null); }}
              placeholder='{"card":{"name":"褚璇玑","slug":"chu-xuanji",...},"operatorFields":{"rarity":"free","priceCandle":0}}'
              style={{ minHeight: 240, fontFamily: 'var(--font-mono)', fontSize: 12 }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 16 }}>
            <button type="button" className="btn" onClick={handlePreview} disabled={busy || !raw.trim()}>
              <Upload size={14} /> 解析预览
            </button>
          </div>

          {preview && (
            <div style={{ display: 'grid', gap: 12 }}>
              <ImportStatus preview={preview} />
              {preview.character && (
                <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12 }}>
                  <h3>标准化结果</h3>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 10 }}>
                    <Metric label="名称" value={preview.character.name} />
                    <Metric label="Slug" value={preview.character.slug} mono />
                    <Metric label="设定项" value={String(preview.character.profileSections?.length ?? 0)} />
                    <Metric label="动作" value={preview.action === 'update' ? '更新' : preview.action === 'create' ? '创建' : '不可导入'} />
                  </div>
                  <div style={{ marginTop: 10, color: 'var(--paper-dim)' }}>
                    {preview.existing ? `将覆盖已有角色：${preview.existing.name} (${preview.existing.slug})` : '未发现同 slug 角色，将新建。'}
                  </div>
                </div>
              )}
              {preview.tier2.detected && (
                <div style={{ border: '1px solid var(--warn)', borderRadius: 6, padding: 12, color: 'var(--warn)' }}>
                  已识别 tier2：{preview.tier2.userRoleName ? `用户角色 ${preview.tier2.userRoleName}，` : ''}
                  memo {preview.tier2.memoCount ?? 0} 条。当前版本只导入主角色卡，tier2 暂不入库。
                </div>
              )}
              <IssueList title="错误" issues={preview.errors} tone="error" />
              <IssueList title="警告" issues={preview.warnings} tone="warning" />
              <div className="field">
                <label>变更原因（提交时必填）</label>
                <input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="例如：导入小说蒸馏角色包 褚璇玑"
                  disabled={!preview.canImport}
                />
              </div>
            </div>
          )}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn" onClick={onCancel}>取消</button>
          <button type="button" className="btn btn-primary" onClick={handleImport} disabled={busy || !preview?.canImport || !reason.trim()}>
            确认导入
          </button>
        </div>
      </div>
    </div>
  );
}

function ImportStatus({ preview }: { preview: AdminCharacterImportPreviewResponse }) {
  const ok = preview.canImport;
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      border: `1px solid ${ok ? 'var(--ok)' : 'var(--danger)'}`,
      color: ok ? 'var(--ok)' : 'var(--danger)',
      borderRadius: 6,
      padding: 12,
    }}>
      {ok ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
      <span>{ok ? '预览通过，可以导入。' : '预览未通过，先修 JSON 或字段。'}</span>
    </div>
  );
}

function Metric({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="metric-label">{label}</div>
      <div style={{
        color: 'var(--paper)',
        fontFamily: mono ? 'var(--font-mono)' : 'var(--font-ui)',
        overflowWrap: 'anywhere',
      }}>{value}</div>
    </div>
  );
}

function IssueList({ title, issues, tone }: {
  title: string;
  issues: AdminCharacterImportPreviewResponse['warnings'];
  tone: 'warning' | 'error';
}) {
  if (issues.length === 0) return null;
  const color = tone === 'warning' ? 'var(--warn)' : 'var(--danger)';
  return (
    <div style={{ border: `1px solid ${color}`, borderRadius: 6, padding: 12 }}>
      <h3 style={{ color }}>{title}</h3>
      <ul style={{ paddingLeft: 18, color, lineHeight: 1.8 }}>
        {issues.map((item, index) => (
          <li key={`${item.code}-${item.path}-${index}`}>
            <span style={{ fontFamily: 'var(--font-mono)' }}>{item.path}</span>：{item.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
