import { useEffect, useRef, useState } from 'react';
import type { ApiChatPage, ApiKeyView } from '@yelan/shared';
import { api, getAuthHeaders, getBase } from '../api/client';
import { groupKeysByPhone, keyPhoneLabel } from './api-key-groups';
import { RecordReader } from '../components/RecordReader';

const root = '/api/admin/api-gateway';
type User = { id: string; name: string };
const rangeFor = (days: string) => ({
  from: new Date(Date.now() - Number(days) * 86400000).toISOString(),
  to: new Date().toISOString(),
});

export function ApiConversations({ onDiagnostics }: { onDiagnostics: (keyId: string) => void }) {
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selected, setSelected] = useState(() => sessionStorage.getItem('gateway.filterKey') ?? '');
  const [search, setSearch] = useState('');
  const [days, setDays] = useState('7');
  const [range, setRange] = useState(() => rangeFor('7'));
  const [page, setPage] = useState<ApiChatPage>({ messages: [], nextCursor: null });
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const sequence = useRef(0);
  const timeline = useRef<HTMLDivElement>(null);
  const position = useRef<{ height: number; top: number } | null>(null);
  const selectedKey = keys.find((key) => key.id === selected);
  const owner = (key: ApiKeyView) =>
    users.find((user) => user.id === key.userId)?.name || key.userId;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      api.get<{ keys: ApiKeyView[] }>(`${root}/keys`),
      api.get<{ users: User[] }>(`${root}/users`),
    ])
      .then(([keyData, userData]) => {
        if (cancelled) return;
        const ordered = keyData.keys.sort((a, b) =>
          (b.lastUsedAt ?? b.createdAt).localeCompare(a.lastUsedAt ?? a.createdAt),
        );
        setKeys(ordered);
        setUsers(userData.users);
        setSelected((current) =>
          ordered.some((key) => key.id === current) ? current : (ordered[0]?.id ?? ''),
        );
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  useEffect(() => {
    const current = ++sequence.current;
    setPage({ messages: [], nextCursor: null });
    position.current = null;
    if (!selected) {
      setBusy(false);
      return;
    }
    setBusy(true);
    setError('');
    void api
      .get<ApiChatPage>(
        `${root}/conversations/${encodeURIComponent(selected)}?${new URLSearchParams(range)}`,
      )
      .then((result) => {
        if (sequence.current === current) setPage(result);
      })
      .catch((e: Error) => {
        if (sequence.current === current) setError(e.message);
      })
      .finally(() => {
        if (sequence.current === current) setBusy(false);
      });
    return () => {
      sequence.current = current + 1;
    };
  }, [selected, range]);

  useEffect(() => {
    const element = timeline.current;
    if (!element) return;
    const previous = position.current;
    element.scrollTop = previous
      ? previous.top + element.scrollHeight - previous.height
      : element.scrollHeight;
    position.current = null;
  }, [page.messages]);

  async function older() {
    if (!page.nextCursor || busy) return;
    const current = sequence.current;
    setBusy(true);
    setError('');
    try {
      const result = await api.get<ApiChatPage>(
        `${root}/conversations/${encodeURIComponent(selected)}?${new URLSearchParams({ ...range, before: page.nextCursor })}`,
      );
      if (sequence.current !== current) return;
      const element = timeline.current;
      position.current = element ? { height: element.scrollHeight, top: element.scrollTop } : null;
      setPage((previous) => ({
        messages: [...result.messages, ...previous.messages],
        nextCursor: result.nextCursor,
      }));
    } catch (e) {
      if (sequence.current === current) setError((e as Error).message);
    } finally {
      if (sequence.current === current) setBusy(false);
    }
  }
  async function download() {
    setExporting(true);
    setError('');
    try {
      const response = await fetch(
        `${getBase()}${root}/records/export?${new URLSearchParams({ ...range, keyId: selected, format: 'chat' })}`,
        { headers: getAuthHeaders() },
      );
      if (!response.ok)
        throw new Error(((await response.json()) as { message?: string }).message || '导出失败');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'yetland-api-chat.txt';
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const visible = keys.filter((key) =>
    `${keyPhoneLabel(key)} ${key.name} ${key.prefix} ${key.id} ${owner(key)} ${key.userId}`
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  return (
    <div className="gateway-panel">
      <header className="gateway-heading">
        <h2>API 聊天记录</h2>
        <p className="muted">
          按验证码绑定手机号或邮箱分类，选择 Key 名称查看问答。共用 Key 的客户端显示在同一时间线。
        </p>
      </header>
      <div className="gateway-toolbar">
        <label>
          时间范围
          <select
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setRange(rangeFor(e.target.value));
            }}
          >
            <option value="1">最近 24 小时</option>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
          </select>
        </label>
        <button className="btn" disabled={busy} onClick={() => setRange(rangeFor(days))}>
          刷新对话
        </button>
      </div>
      {error && (
        <p role="alert" className="gateway-error">
          {error}
        </p>
      )}
      <div className="gateway-chat-layout">
        <aside className="gateway-chat-keys" aria-label="Key 列表">
          <input
            aria-label="搜索手机号、邮箱、Key 名称或用户"
            placeholder="搜索手机号、邮箱、Key 名称或用户"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {groupKeysByPhone(visible).map((group) => (
            <section className="gateway-phone-group" key={group.phone}>
              <h3>{group.phone}</h3>
              {group.keys.map((key) => (
                <button
                  key={key.id}
                  className={`gateway-chat-key ${selected === key.id ? 'selected' : ''}`}
                  aria-pressed={selected === key.id}
                  onClick={() => {
                    setSelected(key.id);
                    sessionStorage.setItem('gateway.filterKey', key.id);
                  }}
                >
                  <strong>{key.name}</strong>
                  <span>{owner(key)}</span>
                  <small>
                    {key.prefix}… · {key.tier === 'pure' ? '纯净版' : '高级版'}
                  </small>
                </button>
              ))}
            </section>
          ))}
          {!visible.length && <p className="muted">没有匹配的 Key</p>}
        </aside>
        <section className="gateway-chat-reader" aria-label="对话内容">
          <div className="gateway-chat-header">
            <strong>
              {selectedKey ? `${keyPhoneLabel(selectedKey)} · ${selectedKey.name}` : '请选择 Key'}
            </strong>
            <details className="gateway-chat-more">
              <summary>更多</summary>
              <div>
                <button
                  className="btn"
                  disabled={!selected || exporting}
                  onClick={() => void download()}
                >
                  {exporting ? '导出中…' : '导出当前范围对话'}
                </button>
                <button
                  className="btn"
                  disabled={!selected}
                  onClick={() => onDiagnostics(selected)}
                >
                  查看统计与诊断
                </button>
              </div>
            </details>
          </div>
          <div ref={timeline} className="gateway-chat-messages" aria-busy={busy}>
            {page.nextCursor && (
              <button
                className="btn gateway-chat-older"
                disabled={busy}
                onClick={() => void older()}
              >
                加载更早对话
              </button>
            )}
            {page.messages.map((message) => (
              <article key={message.id} className={`gateway-chat-message ${message.role}`}>
                <RecordReader value={message.content} label={message.role === 'user' ? '用户' : 'AI'} />
              </article>
            ))}
            {busy && <p className="muted">正在读取对话…</p>}
            {!busy && !page.messages.length && <p className="muted">该时间范围暂无对话内容</p>}
          </div>
        </section>
      </div>
    </div>
  );
}
