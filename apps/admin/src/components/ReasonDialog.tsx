import { useState } from 'react';

interface Props {
  open: boolean;
  title: string;
  message?: string;
  placeholder?: string;
  confirmLabel?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

export function ReasonDialog({ open, title, message, placeholder, confirmLabel = '确认', onConfirm, onCancel }: Props) {
  const [reason, setReason] = useState('');

  if (!open) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) return;
    onConfirm(reason.trim());
    setReason('');
  };

  const handleCancel = () => {
    setReason('');
    onCancel();
  };

  return (
    <div className="modal-overlay" onClick={handleCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {message && <p style={{ color: 'var(--paper-dim)', marginBottom: 16 }}>{message}</p>}
        <form onSubmit={handleSubmit}>
          <div className="field">
            <label>变更原因（必填）</label>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              required
              autoFocus
              placeholder={placeholder ?? '例如：运营需要 / bug 修复 / 配置调整'}
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={handleCancel}>取消</button>
            <button type="submit" className="btn btn-primary" disabled={!reason.trim()}>{confirmLabel}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
