interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDanger({ open, title, message, confirmLabel = '确定删除', onConfirm, onCancel }: Props) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <h2>{title}</h2>
        <p style={{ color: 'var(--paper-dim)', marginBottom: 20 }}>{message}</p>
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>取消</button>
          <button className="btn btn-danger" onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
