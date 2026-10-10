'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, MessageCircle, Plus, Search, X } from 'lucide-react';
import { pinyin } from 'pinyin-pro';
import { yelanRequest } from '@/lib/yelan-managed-client';
import { bootstrapYelanLocal } from '@/lib/yelan-local-bootstrap';
import { loadCharacters } from '@/lib/character-storage';
import { addChatContact, createOrGetSession } from '@/lib/chat-storage';
import type { ManagedRole } from '@/lib/yelan-role-rules';
import type { PhoneRoleRules } from '../../packages/shared/src/contracts/phone';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
function initial(name: string) {
  const letter = pinyin(name.trim().slice(0, 1), { pattern: 'first', toneType: 'none' }).toUpperCase().slice(0, 1);
  return /^[A-Z]$/.test(letter) ? letter : '#';
}
function Avatar({ role, large = false }: { role: ManagedRole; large?: boolean }) {
  return <span className={`ios-contact-avatar${large ? ' is-large' : ''}`}>
    {role.avatar ? <img src={role.avatar} alt="" /> : role.name.slice(0, role.name.length <= 2 ? 2 : 1)}
  </span>;
}

export function YelanRoleApp({ onClose, onChat }: { onClose: () => void; onChat: (sessionId: string) => void }) {
  const [roles, setRoles] = useState<ManagedRole[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PhoneRoleRules | null>(null);
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const groupsRef = useRef<Record<string, HTMLElement | null>>({});
  const selected = roles.find(role => role.id === selectedId) ?? null;
  async function reload() {
    setLoading(true);
    try {
      const data = await yelanRequest<{ characters: ManagedRole[] }>('/phone/bootstrap');
      const avatars = new Map(loadCharacters().map(role => [role.id, role.avatar]));
      setRoles(data.characters.map(role => ({ ...role, avatar: avatars.get(role.id) ?? role.avatar })));
      setNotice('');
    } catch (e) { setNotice(e instanceof Error ? e.message : '联系人加载失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void reload(); }, []);
  const groups = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    const filtered = roles.filter(role => !needle || role.name.toLocaleLowerCase().includes(needle)
      || pinyin(role.name, { toneType: 'none', separator: '' }).toLowerCase().includes(needle));
    const result = new Map<string, ManagedRole[]>();
    filtered.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).forEach(role => {
      const key = initial(role.name);
      result.set(key, [...(result.get(key) ?? []), role]);
    });
    return alphabet.filter(letter => result.has(letter)).map(letter => ({ letter, roles: result.get(letter)! }));
  }, [roles, query]);
  function open(role: ManagedRole) {
    setSelectedId(role.id); setEditing(false); setDraft(null); setNotice('');
  }
  function chat(role: ManagedRole) {
    addChatContact(role.id);
    onChat(createOrGetSession(role.id).id);
  }
  async function save() {
    if (!selected?.canEdit || !draft) return;
    setBusy(true); setNotice('');
    try {
      const validRegex = (pattern: string) => { try { new RegExp(pattern); return true; } catch { return false; } };
      if (draft.worldBook.some(row => !row.content.trim() || (!row.constant && !row.key.trim()) || (row.useRegex && !validRegex(row.key)))
        || draft.regexes.some(row => !row.pattern.trim() || !validRegex(row.pattern))) {
        setNotice('请补全世界书正文、触发词，并检查正则表达式。'); return;
      }
      await yelanRequest(`/phone/characters/${encodeURIComponent(selected.id)}/rules`, { method: 'PUT', body: JSON.stringify(draft) });
      setRoles(current => current.map(role => role.id === selected.id ? { ...role, rules: draft } : role));
      await bootstrapYelanLocal();
      setEditing(false); setNotice('已保存，角色在各个玩法中共用这些规则。');
    } catch { setNotice('保存未完成，请重试或返回夜阑检查登录状态。'); }
    finally { setBusy(false); }
  }
  return <section className="ios-contacts" aria-label="联系人">
    <header className="ios-contacts-nav">
      <button type="button" className="ios-circle-button" disabled={busy} onClick={() => {
        if (editing) { setEditing(false); setDraft(null); }
        else if (selected) { setSelectedId(null); setNotice(''); }
        else if (adding) setAdding(false);
        else onClose();
      }} aria-label={editing ? '取消编辑' : selected || adding ? '返回联系人' : '返回桌面'}><ChevronLeft size={25} /></button>
      <h1>{editing ? '编辑规则' : selected ? '联系人详情' : adding ? '添加聊天联系人' : '联系人'}</h1>
      {selected?.canEdit && !editing ? <button className="ios-text-button" onClick={() => { setDraft(structuredClone(selected.rules)); setEditing(true); setNotice(''); }}>编辑</button> : <span className="ios-nav-spacer" />}
    </header>
    {notice && <div className="ios-contact-notice" role="status">{notice}{!selected && <button onClick={() => void reload()}>重试</button>}</div>}
    {adding && !selected && <p className="ios-contact-add-hint">选择一位夜阑角色，添加到聊天通讯录。</p>}
    {editing && selected && draft ? <form className="ios-rules-form" onSubmit={e => { e.preventDefault(); void save(); }}>
      <label>补充预设<textarea value={draft.preset} maxLength={12000} onChange={e => setDraft({ ...draft, preset: e.target.value })} rows={5} placeholder="补充角色在小手机中的行为与表达" /></label>
      <h2>世界书</h2>
      {draft.worldBook.map((row, i) => <fieldset key={i}><legend>条目 {i + 1}</legend>
        <label>触发词<input value={row.key} maxLength={500} onChange={e => setDraft({ ...draft, worldBook: draft.worldBook.map((item, j) => j === i ? { ...item, key: e.target.value } : item) })} /></label>
        <label>正文<textarea value={row.content} maxLength={6000} rows={3} onChange={e => setDraft({ ...draft, worldBook: draft.worldBook.map((item, j) => j === i ? { ...item, content: e.target.value } : item) })} /></label>
        {(['constant', 'useRegex'] as const).map(key => <label className="ios-toggle-row" key={key}>{key === 'constant' ? '常驻条目' : '正则匹配'}<input type="checkbox" checked={row[key]} onChange={e => setDraft({ ...draft, worldBook: draft.worldBook.map((item, j) => j === i ? { ...item, [key]: e.target.checked } : item) })} /></label>)}
        <label>插入位置<select value={row.position} onChange={e => setDraft({ ...draft, worldBook: draft.worldBook.map((item, j) => j === i ? { ...item, position: e.target.value as typeof row.position } : item) })}><option value="before_char">角色设定之前</option><option value="after_char">角色设定之后</option></select></label>
        <button type="button" className="ios-delete-button" onClick={() => setDraft({ ...draft, worldBook: draft.worldBook.filter((_, j) => j !== i) })}>删除条目</button>
      </fieldset>)}
      <button type="button" className="ios-text-button" disabled={draft.worldBook.length >= 100} onClick={() => setDraft({ ...draft, worldBook: [...draft.worldBook, { key: '', content: '', constant: false, useRegex: false, position: 'after_char' }] })}>＋ 添加世界书条目</button>
      <h2>文本规则</h2>
      {draft.regexes.map((row, i) => <fieldset key={i}><legend>规则 {i + 1}</legend>
        {(['name', 'pattern', 'replacement'] as const).map(key => <label key={key}>{({ name: '名称', pattern: '正则表达式', replacement: '替换内容' })[key]}<input value={row[key]} maxLength={key === 'pattern' ? 500 : key === 'name' ? 100 : 4000} onChange={e => setDraft({ ...draft, regexes: draft.regexes.map((item, j) => j === i ? { ...item, [key]: e.target.value } : item) })} /></label>)}
        <label>应用于<select value={row.target} onChange={e => setDraft({ ...draft, regexes: draft.regexes.map((item, j) => j === i ? { ...item, target: e.target.value as typeof row.target } : item) })}><option value="input">用户输入</option><option value="output">角色回复</option></select></label>
        <label className="ios-toggle-row">停用<input type="checkbox" checked={row.disabled} onChange={e => setDraft({ ...draft, regexes: draft.regexes.map((item, j) => j === i ? { ...item, disabled: e.target.checked } : item) })} /></label>
        <button type="button" className="ios-delete-button" onClick={() => setDraft({ ...draft, regexes: draft.regexes.filter((_, j) => j !== i) })}>删除规则</button>
      </fieldset>)}
      <button type="button" className="ios-text-button" disabled={draft.regexes.length >= 50} onClick={() => setDraft({ ...draft, regexes: [...draft.regexes, { name: '文本规则', pattern: '', replacement: '', target: 'output', disabled: false }] })}>＋ 添加文本规则</button>
      <button className="ios-primary-button" disabled={busy}>{busy ? '保存中…' : '保存规则'}</button>
    </form> : selected ? <div className="ios-contact-detail">
      <Avatar role={selected} large /><h2>{selected.name}</h2><p className="ios-contact-kind">{selected.canEdit ? '我的角色' : '公共角色'}</p>
      <button className="ios-contact-message" onClick={() => chat(selected)}><MessageCircle size={22} /><span>发消息</span></button>
      <div className="ios-contact-info"><h3>角色介绍</h3><p>{selected.persona || '还没有填写角色介绍。'}</p></div>
      <div className="ios-contact-info"><h3>小手机规则</h3><p>{selected.rules.preset || '使用角色的默认设定。'}</p><small>{selected.rules.worldBook.length} 个世界书条目 · {selected.rules.regexes.length} 条文本规则</small></div>
      <p className="ios-contact-footnote">{selected.canEdit ? '点击右上角编辑，调整此角色在各个玩法中共用的规则。' : '公共角色的设定由夜阑统一维护。'}</p>
    </div> : <>
      <div className="ios-contact-list">
        {loading && !roles.length && <p className="ios-contact-empty" role="status">正在载入联系人…</p>}
        {!loading && !groups.length && <p className="ios-contact-empty">{query ? '没有找到联系人' : '暂无可用角色，请在夜阑添加角色后重试。'}</p>}
        {groups.map(group => <section key={group.letter} ref={el => { groupsRef.current[group.letter] = el; }}>
          <h2 className="ios-contact-letter">{group.letter}</h2>
          {group.roles.map(role => <button type="button" className="ios-contact-row" key={role.id} aria-label={role.name} onClick={() => {
            const wasAdding = adding;
            if (wasAdding) { addChatContact(role.id); setAdding(false); }
            open(role);
            if (wasAdding) setNotice('已添加到聊天通讯录');
          }}><Avatar role={role} /><span className="ios-contact-row-name">{role.name}</span>{role.canEdit && <span className="ios-contact-mine">我的</span>}<ChevronRight size={16} /></button>)}
        </section>)}
      </div>
      <nav className="ios-contact-index" aria-label="联系人字母索引">{alphabet.map(letter => <button key={letter} type="button" disabled={!groups.some(group => group.letter === letter)} onClick={() => groupsRef.current[letter]?.scrollIntoView({ block: 'start', behavior: 'smooth' })} aria-label={`跳转到 ${letter}`}>{letter}</button>)}</nav>
      <footer className="ios-contacts-bottom"><div className="ios-contact-tools"><label className="ios-contact-search"><Search size={21} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索" aria-label="搜索联系人" />{query && <button onClick={() => setQuery('')} aria-label="清除搜索"><X size={17} /></button>}</label>
        <button className="ios-circle-button" onClick={() => { setAdding(!adding); setQuery(''); }} aria-label={adding ? '取消添加' : '添加聊天联系人'}>{adding ? <X size={26} /> : <Plus size={28} />}</button></div><p>{groups.reduce((sum, group) => sum + group.roles.length, 0)} 位联系人</p></footer>
    </>}
  </section>;
}
