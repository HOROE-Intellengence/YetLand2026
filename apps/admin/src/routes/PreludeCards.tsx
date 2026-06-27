import { useEffect, useState } from 'react';
import { FileText, Plus, Circle } from 'lucide-react';
import {
  AdminPreludeCardCreateSchema,
  AdminPreludeCardPatchSchema,
  AdminPreludeCardsListResponseSchema,
  type AdminPreludeCardCreate,
  type AdminPreludeCardPatch,
  type PreludeCardScope,
} from '@yelan/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

interface PreludeCard {
  id: string;
  name: string;
  content: string;
  scope: PreludeCardScope;
  characterId?: string | null;
  priority: number;
  isActive: boolean;
  updatedAt: string;
}

export function PreludeCards() {
  const { success, error: toastErr } = useToast();
  const [cards, setCards] = useState<PreludeCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<PreludeCard | null>(null);

  const load = async () => {
    try {
      const data = await api.get<{ preludeCards: PreludeCard[] }>('/api/admin/prelude-cards');
      const parsed = AdminPreludeCardsListResponseSchema.parse(data);
      setCards(parsed.preludeCards);
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载前置提示卡失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(body: AdminPreludeCardCreate) {
    try {
      const parsed = AdminPreludeCardCreateSchema.parse(body);
      await api.post('/api/admin/prelude-cards', parsed);
      success('前置提示卡创建成功');
      setShowForm(false);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function handlePatch(id: string, body: AdminPreludeCardPatch) {
    try {
      const parsed = AdminPreludeCardPatchSchema.parse(body);
      await api.patch(`/api/admin/prelude-cards/${id}`, parsed);
      success('前置提示卡更新成功');
      setEditing(null);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function handleToggle(card: PreludeCard) {
    if (!window.confirm(`确定要${card.isActive ? '停用' : '启用'}「${card.name}」吗？`)) return;
    try {
      if (card.isActive) {
        await api.delete(`/api/admin/prelude-cards/${card.id}?reason=${encodeURIComponent('admin toggle')}`);
      } else {
        await api.post(`/api/admin/prelude-cards/${card.id}/_enable?reason=${encodeURIComponent('admin toggle')}`);
      }
      success(card.isActive ? '已停用' : '已启用');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  if (loading) return <div className="state-placeholder"><FileText size={32} /><span>加载前置提示卡…</span></div>;
  if (err) return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>前置提示卡</h2>
        <button className="btn btn-primary" onClick={() => setShowForm(true)}>
          <Plus size={14} /> 新建提示卡
        </button>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>ID</th><th>名称</th><th>作用域</th><th>角色</th><th>优先级</th><th>状态</th><th>操作</th></tr>
          </thead>
          <tbody>
            {cards.map((card) => (
              <tr key={card.id}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{card.id}</td>
                <td>{card.name}</td>
                <td><span className="badge badge-warn">{card.scope}</span></td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{card.characterId || '-'}</td>
                <td>{card.priority}</td>
                <td><span className={`badge ${card.isActive ? 'badge-ok' : 'badge-danger'}`}>{card.isActive ? '启用' : '停用'}</span></td>
                <td>
                  <button className="btn btn-sm" onClick={() => setEditing(card)} style={{ marginRight: 6 }}>编辑</button>
                  <button className="btn btn-sm btn-danger" onClick={() => handleToggle(card)}>
                    {card.isActive ? '停用' : '启用'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {(showForm || editing) && (
        <PreludeCardForm
          initial={editing}
          onSave={(body) => {
            if (editing) handlePatch(editing.id, body);
            else handleCreate(body as AdminPreludeCardCreate);
          }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function PreludeCardForm({ initial, onSave, onCancel }: {
  initial: PreludeCard | null;
  onSave: (body: AdminPreludeCardCreate | AdminPreludeCardPatch) => void;
  onCancel: () => void;
}) {
  const [id, setId] = useState(initial?.id ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [content, setContent] = useState(initial?.content ?? '');
  const [scope, setScope] = useState<PreludeCardScope>(initial?.scope ?? 'if');
  const [characterId, setCharacterId] = useState(initial?.characterId ?? '');
  const [priority, setPriority] = useState(initial?.priority ?? 100);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);
  const [reason, setReason] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return;
    onSave({
      ...(!initial && id ? { id } : {}),
      name,
      content,
      scope,
      characterId: characterId.trim() || null,
      priority,
      isActive,
      reason,
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 760, width: '70vw' }}>
        <h2>{initial ? '编辑前置提示卡' : '新建前置提示卡'}</h2>
        <form onSubmit={handleSubmit}>
          {!initial && (
            <div className="field">
              <label>ID</label>
              <input value={id} onChange={(e) => setId(e.target.value)} pattern="^[a-z0-9-]+$" placeholder="if-default" />
            </div>
          )}
          <div className="field">
            <label>名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} />
          </div>
          <div className="field">
            <label>作用域</label>
            <select value={scope} onChange={(e) => setScope(e.target.value as PreludeCardScope)}>
              <option value="if">IF 解锁</option>
              <option value="character">指定角色</option>
              <option value="global">全局</option>
            </select>
          </div>
          <div className="field">
            <label>角色 ID（可选）</label>
            <input value={characterId ?? ''} onChange={(e) => setCharacterId(e.target.value)} placeholder="shen-yan-zhi" />
          </div>
          <div className="field">
            <label>优先级</label>
            <input type="number" value={priority} onChange={(e) => setPriority(Number(e.target.value))} min={0} max={1000} />
          </div>
          <div className="field">
            <label>内容</label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} required maxLength={12000} style={{ minHeight: 260 }} />
          </div>
          <div className="field">
            <label>
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} style={{ width: 'auto', marginRight: 8 }} />
              启用
            </label>
          </div>
          <div className="field">
            <label>变更原因（必填）</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="例如：调整 IF 前置提示" />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn" onClick={onCancel}>取消</button>
            <button type="submit" className="btn btn-primary">{initial ? '保存' : '创建'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
