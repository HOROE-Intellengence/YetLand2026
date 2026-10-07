'use client';
import { useEffect, useState } from 'react';
import { yelanRequest } from '@/lib/yelan-managed-client';
import { bootstrapYelanLocal } from '@/lib/yelan-local-bootstrap';
import type { ManagedRole } from '@/lib/yelan-role-rules';

export function YelanRoleApp({ onClose }: { onClose: () => void }) {
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [selected, setSelected] = useState<ManagedRole | null>(null);
  const [text, setText] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { yelanRequest<{ characters: ManagedRole[] }>('/phone/bootstrap').then(data => setRoles(data.characters)).catch(e => setNotice(e.message)); }, []);
  async function save() {
    if (!selected?.canEdit) return;
    setBusy(true);
    try {
      const rules = JSON.parse(text);
      await yelanRequest(`/phone/characters/${encodeURIComponent(selected.id)}/rules`, { method: 'PUT', body: JSON.stringify(rules) });
      await bootstrapYelanLocal();
      setNotice('已保存，此角色在各个小手机玩法中共用这些规则。');
    } catch { setNotice('保存失败，请检查规则格式、登录状态和角色权限。'); }
    finally { setBusy(false); }
  }
  return <section style={{ padding: 20, overflow: 'auto', height: '100%', background: '#faf9f5', color: '#222' }}>
    <button onClick={onClose}>返回桌面</button><h2>夜阑角色</h2>
    <p>角色与夜阑共用。公共角色由后台管理；你可以编辑自己私有角色的小手机规则。</p>
    {roles.map(role => <button key={role.id} onClick={() => { setSelected(role); setText(JSON.stringify(role.rules, null, 2)); setNotice(''); }} style={{ display: 'block', margin: '12px 0' }}>{role.name}{role.canEdit ? ' · 可编辑' : ''}</button>)}
    {selected && <div><h3>{selected.name}</h3><p>{selected.persona}</p>
      {selected.canEdit && <><label htmlFor="phone-role-rules">预设、世界书和正则规则</label>
        <textarea id="phone-role-rules" value={text} onChange={e => setText(e.target.value)} rows={16} style={{ width: '100%', fontFamily: 'monospace' }} />
        <p>preset 填补充预设；worldBook 填触发词 key 和正文 content；regexes 填 pattern、replacement 及 target（input/output）。</p>
        <button disabled={busy} onClick={() => void save()}>{busy ? '保存中…' : '保存角色规则'}</button></>}
    </div>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
