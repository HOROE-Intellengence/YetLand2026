import { useEffect, useState } from 'react';
import { UserCheck, Plus, Circle, Upload, FileJson, Check, X } from 'lucide-react';
import {
  AdminCharactersCreateSchema,
  AdminCharactersPatchSchema,
  AdminCharactersListResponseSchema,
  type AdminCharactersCreate,
  type AdminCharactersPatch,
  type AdminCharacterJsonResponse,
  type CharacterProfileSection,
  type VoiceName, type HqVoiceProfileId, HQ_VOICE_OPTIONS, defaultHqVoiceProfile,
  VOICE_OPTIONS, DEFAULT_VOICE_NAME,
  PhoneRoleRulesSchema, type PhoneRoleRules,
} from '@yelan/shared';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { JsonViewer } from '../components/JsonViewer';
import { CharacterImportDialog } from './CharacterImportDialog';

type Origin = 'admin' | 'user';
type ReviewStatus = 'none' | 'private' | 'pending' | 'approved' | 'rejected';

interface Character {
  id: string; slug: string; name: string; rarity: string;
  priceCandle: number; styleTags: string[]; boundaryDefault: number; isActive: boolean;
  preludeCardId?: string | null;
  voiceName?: VoiceName;
  hqVoiceProfileId?: HqVoiceProfileId;
  openingLines: { firstVisit: string; returnVisit: string };
  description?: string; forbiddenPhrases?: string[]; updatedAt?: string;
  profileSections: CharacterProfileSection[];
  phoneRules?: PhoneRoleRules;
  origin?: Origin;
  ownerUserId?: string | null;
  visibility?: 'private' | 'public';
  reviewStatus?: ReviewStatus;
}

const REVIEW_BADGE: Record<ReviewStatus, { label: string; cls: string }> = {
  none: { label: '—', cls: '' },
  private: { label: '私有', cls: '' },
  pending: { label: '待审', cls: 'badge-warn' },
  approved: { label: '已通过', cls: 'badge-ok' },
  rejected: { label: '已驳回', cls: 'badge-danger' },
};

interface PreludeCardOption {
  id: string;
  name: string;
  scope: string;
  isActive: boolean;
}

export function Characters() {
  const { success, error: toastErr } = useToast();
  const [chars, setChars] = useState<Character[]>([]);
  const [preludeCards, setPreludeCards] = useState<PreludeCardOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [editing, setEditing] = useState<Character | null>(null);
  const [pendingOnly, setPendingOnly] = useState(false);
  const [jsonView, setJsonView] = useState<AdminCharacterJsonResponse | null>(null);

  const load = async () => {
    try {
      const data = await api.get<{ characters: Character[] }>('/api/admin/characters');
      const parsed = AdminCharactersListResponseSchema.parse(data);
      setChars(parsed.characters);
      const prelude = await api.get<{ preludeCards: PreludeCardOption[] }>('/api/admin/prelude-cards');
      setPreludeCards(prelude.preludeCards);
    } catch (e) {
      setErr((e as Error).message);
      toastErr('加载角色卡失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleCreate(body: AdminCharactersCreate) {
    try {
      const parsed = AdminCharactersCreateSchema.parse(body);
      await api.post('/api/admin/characters', parsed);
      success('角色卡创建成功');
      setShowForm(false);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function handlePatch(id: string, body: AdminCharactersPatch) {
    try {
      const parsed = AdminCharactersPatchSchema.parse(body);
      await api.patch(`/api/admin/characters/${id}`, parsed);
      success('角色卡更新成功');
      setEditing(null);
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function handleViewJson(id: string) {
    try {
      const data = await api.get<AdminCharacterJsonResponse>(`/api/admin/characters/${id}/json`);
      setJsonView(data);
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function handleReview(character: Character, action: 'approve' | 'reject') {
    const verb = action === 'approve' ? '通过' : '驳回';
    const reason = window.prompt(`${verb}「${character.name}」的理由（必填）`, action === 'approve' ? '内容合规' : '');
    if (!reason) return;
    try {
      await api.post(`/api/admin/characters/${character.id}/review`, { action, reason });
      success(action === 'approve' ? '已通过，角色已开放为常驻' : '已驳回');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  async function handleToggle(character: Character) {
    if (!window.confirm(`确定要${character.isActive ? '停用' : '启用'}「${character.name}」吗？`)) return;
    try {
      if (character.isActive) {
        await api.delete(`/api/admin/characters/${character.id}?reason=${encodeURIComponent('admin toggle')}`);
      } else {
        await api.post(`/api/admin/characters/${character.id}/_enable?reason=${encodeURIComponent('admin toggle')}`);
      }
      success(character.isActive ? '已停用' : '已启用');
      await load();
    } catch (e) {
      toastErr((e as Error).message);
    }
  }

  if (loading) {
    return <div className="state-placeholder"><UserCheck size={32} /><span>加载角色卡…</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  const pendingCount = chars.filter((c) => c.reviewStatus === 'pending').length;
  const visible = pendingOnly ? chars.filter((c) => c.reviewStatus === 'pending') : chars;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>角色卡管理</h2>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {pendingCount > 0 && (
            <button
              className={`btn btn-sm ${pendingOnly ? 'btn-primary' : ''}`}
              onClick={() => setPendingOnly((v) => !v)}
            >
              待审 {pendingCount}
            </button>
          )}
          <button className="btn" onClick={() => setShowImport(true)}>
            <Upload size={14} /> 导入角色包
          </button>
          <button className="btn btn-primary" onClick={() => setShowForm(true)}>
            <Plus size={14} /> 新建角色卡
          </button>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="state-placeholder"><UserCheck size={32} /><span>{pendingOnly ? '没有待审角色卡' : '暂无角色卡'}</span></div>
      ) : (
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead>
              <tr><th>ID</th><th>名称</th><th>来源</th><th>稀有度</th><th>边界</th><th>状态</th><th>审核</th><th>操作</th></tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const isUser = c.origin === 'user';
                const review = REVIEW_BADGE[c.reviewStatus ?? 'none'];
                return (
                <tr key={c.id}>
                  <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>{c.slug}</td>
                  <td>{c.name}</td>
                  <td>
                    <span className={`badge ${isUser ? 'badge-warn' : 'badge-ok'}`}>{isUser ? '用户' : 'admin'}</span>
                    {isUser && c.ownerUserId && (
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>{c.ownerUserId}</div>
                    )}
                  </td>
                  <td><span className={`badge ${c.rarity === 'paid' ? 'badge-warn' : c.rarity === 'hidden' ? 'badge-danger' : 'badge-ok'}`}>{c.rarity}</span></td>
                  <td>{c.boundaryDefault}</td>
                  <td><span className={`badge ${c.isActive ? 'badge-ok' : 'badge-danger'}`}>{c.isActive ? '启用' : '停用'}</span></td>
                  <td>{review.cls ? <span className={`badge ${review.cls}`}>{review.label}</span> : review.label}</td>
                  <td>
                    {isUser && (
                      <button className="btn btn-sm" onClick={() => handleViewJson(c.id)} style={{ marginRight: 6 }} title="查看结构化档案">
                        <FileJson size={13} /> JSON
                      </button>
                    )}
                    {isUser && c.reviewStatus === 'pending' && (
                      <>
                        <button className="btn btn-sm btn-primary" onClick={() => handleReview(c, 'approve')} style={{ marginRight: 6 }}>
                          <Check size={13} /> 通过
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => handleReview(c, 'reject')} style={{ marginRight: 6 }}>
                          <X size={13} /> 驳回
                        </button>
                      </>
                    )}
                    <button className="btn btn-sm" onClick={() => setEditing(c)} style={{ marginRight: 6 }}>编辑</button>
                    <button className="btn btn-sm btn-danger" onClick={() => handleToggle(c)}>
                      {c.isActive ? '停用' : '启用'}
                    </button>
                  </td>
                </tr>
              );
              })}
            </tbody>
          </table>
        </div>
      )}

      {jsonView && (
        <div className="modal-overlay" onClick={() => setJsonView(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>档案 · {jsonView.characterName}</h2>
            <div className="modal-scroll">
              <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 0 }}>
                创建人：{jsonView.userName}（{jsonView.ownerUserId ?? '—'}） · 审核态：{REVIEW_BADGE[jsonView.reviewStatus].label}
              </p>
              <JsonViewer data={jsonView} maxHeight={480} />
            </div>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={() => setJsonView(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {(showForm || editing) && (
        <CharacterForm
          initial={editing}
          preludeCards={preludeCards}
          onSave={(body) => {
            if (editing) {
              handlePatch(editing.id, { ...body });
            } else {
              handleCreate({ ...body });
            }
          }}
          onCancel={() => { setShowForm(false); setEditing(null); }}
        />
      )}

      {showImport && (
        <CharacterImportDialog
          onCancel={() => setShowImport(false)}
          onImported={load}
        />
      )}
    </div>
  );
}

function CharacterForm({ initial, preludeCards, onSave, onCancel }: {
  initial: Character | null;
  preludeCards: PreludeCardOption[];
  onSave: (body: AdminCharactersCreate) => void;
  onCancel: () => void;
}) {
  const splitList = (value: string) => value
    .split(/[,，、\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

  const [reason, setReason] = useState('');
  const [slug, setSlug] = useState(initial?.slug ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [rarity, setRarity] = useState<'free' | 'paid' | 'hidden'>((initial?.rarity as 'free' | 'paid' | 'hidden') ?? 'free');
  const [priceCandle, setPriceCandle] = useState(initial?.priceCandle ?? 0);
  const [boundaryDefault, setBoundaryDefault] = useState<1 | 2 | 3 | 4 | 5>((initial?.boundaryDefault as 1 | 2 | 3 | 4 | 5) ?? 2);
  const [preludeCardId, setPreludeCardId] = useState(initial?.preludeCardId ?? '');
  const [voiceName, setVoiceName] = useState<VoiceName>(initial?.voiceName ?? DEFAULT_VOICE_NAME);
  const [hqVoiceProfileId, setHqVoiceProfileId] = useState<HqVoiceProfileId>(initial?.hqVoiceProfileId ?? defaultHqVoiceProfile(initial?.voiceName ?? DEFAULT_VOICE_NAME));
  const [styleTags, setStyleTags] = useState((initial?.styleTags ?? []).join(', '));
  const [forbiddenPhrases, setForbiddenPhrases] = useState((initial?.forbiddenPhrases ?? []).join('、'));
  const [description, setDescription] = useState(initial?.description ?? '');
  const [profileSections, setProfileSections] = useState<CharacterProfileSection[]>(initial?.profileSections ?? []);
  const [phonePreset, setPhonePreset] = useState(initial?.phoneRules?.preset ?? '');
  const [phoneWorldBook, setPhoneWorldBook] = useState(JSON.stringify(initial?.phoneRules?.worldBook ?? [], null, 2));
  const [phoneRegexes, setPhoneRegexes] = useState(JSON.stringify(initial?.phoneRules?.regexes ?? [], null, 2));
  const [phoneRulesError, setPhoneRulesError] = useState('');
  const [firstVisit, setFirstVisit] = useState(initial?.openingLines?.firstVisit ?? '');
  const [returnVisit, setReturnVisit] = useState(initial?.openingLines?.returnVisit ?? '');

  const addProfileSection = (key = '') => {
    setProfileSections((prev) => [...prev, { key, value: '', order: prev.length }]);
  };

  const updateProfileSection = (index: number, patch: Partial<CharacterProfileSection>) => {
    setProfileSections((prev) => prev.map((section, i) => (i === index ? { ...section, ...patch } : section)));
  };

  const removeProfileSection = (index: number) => {
    setProfileSections((prev) => prev.filter((_, i) => i !== index).map((section, order) => ({ ...section, order })));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason) return;
    let phoneRules: PhoneRoleRules;
    try {
      phoneRules = PhoneRoleRulesSchema.parse({ preset: phonePreset, worldBook: JSON.parse(phoneWorldBook), regexes: JSON.parse(phoneRegexes) });
      setPhoneRulesError('');
    } catch { setPhoneRulesError('小手机规则格式有误，请检查 JSON、触发词或正则表达式。'); return; }
    onSave({
      phoneRules,
      slug, name, rarity, priceCandle, boundaryDefault, description,
      preludeCardId: preludeCardId || null,
      voiceName, hqVoiceProfileId,
      styleTags: splitList(styleTags),
      forbiddenPhrases: splitList(forbiddenPhrases),
      profileSections: profileSections
        .map((section) => ({ key: section.key.trim(), value: section.value.trim(), order: section.order }))
        .filter((section) => section.key && section.value)
        .map((section, order) => ({ ...section, order })),
      openingFirstVisit: firstVisit, openingReturnVisit: returnVisit,
      reason,
    });
  };

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>{initial ? '编辑角色卡' : '新建角色卡'}</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }}>
          <div className="modal-scroll">
          <div className="field">
            <label>Slug</label>
            <input value={slug} onChange={(e) => setSlug(e.target.value)} required pattern="^[a-z0-9-]+$" minLength={2} maxLength={40} />
          </div>
          <div className="field">
            <label>名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={40} />
          </div>
          <div className="field">
            <label>稀有度</label>
            <select value={rarity} onChange={(e) => setRarity(e.target.value as 'free' | 'paid' | 'hidden')}>
              <option value="free">免费</option>
              <option value="paid">付费</option>
              <option value="hidden">隐藏</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="character-voice">普通语音音色</label>
            <select id="character-voice" value={voiceName} onChange={e => setVoiceName(e.target.value as VoiceName)}>
              {VOICE_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
            <label htmlFor="character-hq-voice">高质量语音音色</label>
            <select id="character-hq-voice" value={hqVoiceProfileId} onChange={e => setHqVoiceProfileId(e.target.value as HqVoiceProfileId)}>
              {HQ_VOICE_OPTIONS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
            </select>
            <p className="muted">四类默认音色在「语音配置与测试」中填写 Fish ID，保存后下一轮生效。</p>
          </div>
          <div className="field">
            <label>烛价</label>
            <input type="number" value={priceCandle} onChange={(e) => setPriceCandle(Number(e.target.value))} min={0} />
          </div>
          <div className="field">
            <label>默认边界 (1-5)</label>
            <input type="number" value={boundaryDefault} onChange={(e) => setBoundaryDefault(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)} min={1} max={5} />
          </div>
          <div className="field">
            <label>前置提示卡</label>
            <select value={preludeCardId ?? ''} onChange={(e) => setPreludeCardId(e.target.value)}>
              <option value="">不绑定（按 IF / 全局规则选择）</option>
              {preludeCards.map((card) => (
                <option key={card.id} value={card.id}>
                  {card.name} · {card.scope}{card.isActive ? '' : ' · 已停用'}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>开场白（首次）</label>
            <input value={firstVisit} onChange={(e) => setFirstVisit(e.target.value)} maxLength={200} />
          </div>
          <div className="field">
            <label>开场白（再次）</label>
            <input value={returnVisit} onChange={(e) => setReturnVisit(e.target.value)} maxLength={200} />
          </div>
          <div className="field">
            <label>风格标签（逗号或换行分隔）</label>
            <input value={styleTags} onChange={(e) => setStyleTags(e.target.value)} placeholder="modern, restrained, push-pull" />
          </div>
          <div className="field">
            <label>禁用语（逗号或换行分隔）</label>
            <textarea value={forbiddenPhrases} onChange={(e) => setForbiddenPhrases(e.target.value)} maxLength={1000} />
          </div>
          <div className="field">
            <label>描述</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={2000} />
          </div>
          <div className="field">
            <label>设定项目（仅后台与主 AI 可见）</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {['故事', '口癖', '爱好', '家庭状况'].map((label) => (
                <button key={label} type="button" className="btn btn-sm" onClick={() => addProfileSection(label)}>
                  + {label}
                </button>
              ))}
              <button type="button" className="btn btn-sm" onClick={() => addProfileSection()}>
                + 自定义
              </button>
            </div>
            <div style={{ display: 'grid', gap: 10 }}>
              {profileSections.map((section, index) => (
                <div key={index} style={{ display: 'grid', gap: 8, padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input
                      value={section.key}
                      onChange={(e) => updateProfileSection(index, { key: e.target.value })}
                      placeholder="项目名"
                      maxLength={40}
                    />
                    <button type="button" className="btn btn-sm btn-danger" onClick={() => removeProfileSection(index)}>
                      删除
                    </button>
                  </div>
                  <textarea
                    value={section.value}
                    onChange={(e) => updateProfileSection(index, { value: e.target.value })}
                    placeholder="写给主 AI 的私有人设细节"
                    maxLength={2000}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="field">
            <label>变更原因（必填）</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} required placeholder="例如：新增付费角色 江白" />
          </div>
          <details className="field">
            <summary>小手机规则（所有小手机玩法共用此角色卡）</summary>
            <label>补充预设</label>
            <textarea value={phonePreset} onChange={e => setPhonePreset(e.target.value)} maxLength={12000} placeholder="补充角色在小手机中的表达规则；不影响原聊天入口" />
            <label>世界书条目（JSON 数组）</label>
            <p>例：{JSON.stringify([{ key: '咖啡', content: '习惯喝无糖咖啡', constant: false, position: 'after_char' }])}</p>
            <textarea value={phoneWorldBook} onChange={e => setPhoneWorldBook(e.target.value)} rows={6} />
            <label>正则规则（JSON 数组）</label>
            <p>例：{JSON.stringify([{ name: '替换称呼', pattern: '小朋友', replacement: '朋友', target: 'output' }])}</p>
            <textarea value={phoneRegexes} onChange={e => setPhoneRegexes(e.target.value)} rows={6} />
            {phoneRulesError && <p role="alert">{phoneRulesError}</p>}
          </details>
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
