import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type {
  ApiCallView,
  ApiGatewaySettings,
  ApiKeyView,
  ApiOverview,
  ApiPreludeView,
  ApiTier,
} from '@yelan/shared';
import { api, getAuthHeaders, getBase } from '../api/client';
import { useToast } from '../components/Toast';
import './ApiGateway.css';
import { ApiConversations } from './ApiConversations';
import { groupKeysByPhone } from './api-key-groups';

const root = '/api/admin/api-gateway';
const tierLabel = (tier: string) => (tier === 'pure' ? '纯净版' : '高级版');
const time = (value: string | null) => (value ? new Date(value).toLocaleString() : '—');
const pretty = (value: unknown) =>
  typeof value === 'string' ? value : JSON.stringify(value, null, 2);
type SettingsResponse = {
  settings: ApiGatewaySettings;
  smsEnabled: boolean;
  baseUrl: string;
  upstreams: { id: string; name: string; model: string; ready: boolean }[];
};

function Intro({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <header className="gateway-heading">
      <div className="muted">API 管理 · https://yetland.cn/v1</div>
      <h2>{title}</h2>
      <p className="muted">{children}</p>
    </header>
  );
}

export function ApiGatewayOverview() {
  const [view, setView] = useState<'chat' | 'diagnostics'>('chat');
  return (
    <>
      <nav className="gateway-toolbar" aria-label="API 查看方式">
        <button className="btn" aria-pressed={view === 'chat'} onClick={() => setView('chat')}>
          聊天记录
        </button>
        <button
          className="btn"
          aria-pressed={view === 'diagnostics'}
          onClick={() => setView('diagnostics')}
        >
          统计与诊断
        </button>
      </nav>
      {view === 'chat' ? (
        <ApiConversations
          onDiagnostics={(id) => {
            sessionStorage.setItem('gateway.filterKey', id);
            setView('diagnostics');
          }}
        />
      ) : (
        <ApiGatewayDiagnostics />
      )}
    </>
  );
}

function ApiGatewayDiagnostics() {
  const { success, error } = useToast();
  const [tier, setTier] = useState('');
  const [days, setDays] = useState('7');
  const [keyId, setKeyId] = useState(() => sessionStorage.getItem('gateway.filterKey') ?? '');
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<ApiOverview | null>(null);
  const [calls, setCalls] = useState<{ rows: ApiCallView[]; total: number }>({
    rows: [],
    total: 0,
  });
  const [detail, setDetail] = useState<Record<string, unknown> | null>(null);
  const [config, setConfig] = useState<SettingsResponse | null>(null);
  const [settings, setSettings] = useState<ApiGatewaySettings | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const loadSequence = useRef(0);
  const query = useCallback(
    () =>
      new URLSearchParams({
        from: new Date(Date.now() - Number(days) * 86400000).toISOString(),
        ...(tier ? { tier } : {}),
        ...(keyId ? { keyId } : {}),
      }).toString(),
    [days, tier, keyId],
  );
  const load = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const q = query();
      const [overview, records, configuration] = await Promise.all([
        api.get<ApiOverview>(`${root}/overview?${q}`),
        api.get<typeof calls>(`${root}/calls?${q}&offset=${offset}`),
        api.get<SettingsResponse>(`${root}/settings`),
      ]);
      if (sequence !== loadSequence.current) return;
      setData(overview);
      setCalls(records);
      setConfig(configuration);
      setSettings((previous) => previous ?? configuration.settings);
      setErr('');
    } catch (e) {
      if (sequence === loadSequence.current) setErr((e as Error).message);
    }
  }, [query, offset]);
  useEffect(() => {
    void load();
    const t = window.setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => clearInterval(t);
  }, [load]);
  async function saveSettings() {
    setBusy(true);
    try {
      await api.put(`${root}/settings`, settings);
      success('API 网关设置已保存');
      await load();
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function showDetail(id: string) {
    try {
      setDetail(await api.get(`${root}/calls/${id}`));
    } catch (e) {
      error((e as Error).message);
    }
  }
  async function exportTraining(records = false) {
    setBusy(true);
    try {
      const r = await fetch(
        `${getBase()}${root}/${records ? 'records/export' : 'export'}?${query()}`,
        { headers: getAuthHeaders() },
      );
      if (!r.ok) throw new Error(((await r.json()) as { message?: string }).message || '导出失败');
      const blob = await r.blob();
      if (!blob.size) {
        success(
          records
            ? '该范围没有调用记录'
            : '该范围没有已获训练授权的完整记录；测试 Key 数据不进入训练导出',
        );
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = records ? 'yetland-api-records.jsonl' : 'yetland-api-training.jsonl';
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gateway-panel">
      <Intro title="API 调用总览">
        观察两种版本的调用、用量与异常。每 15 秒刷新；Token 仅统计上游实际报告值。
      </Intro>
      <div className="gateway-toolbar">
        <label>
          时间
          <select
            value={days}
            onChange={(e) => {
              setDays(e.target.value);
              setOffset(0);
            }}
          >
            <option value="1">最近 24 小时</option>
            <option value="7">最近 7 天</option>
            <option value="30">最近 30 天</option>
            <option value="90">最近 90 天</option>
          </select>
        </label>
        <label>
          版本
          <select
            value={tier}
            onChange={(e) => {
              setTier(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">全部版本</option>
            <option value="pure">纯净版</option>
            <option value="advanced">高级版</option>
          </select>
        </label>
        <label>
          Key ID
          <input
            placeholder="全部 Key"
            value={keyId}
            onChange={(e) => {
              setKeyId(e.target.value);
              sessionStorage.removeItem('gateway.filterKey');
              setOffset(0);
            }}
          />
        </label>
        <button className="btn" onClick={() => void load()}>
          刷新
        </button>
        <button className="btn" disabled={busy} onClick={() => void exportTraining(true)}>
          导出调用与错误记录
        </button>
        <button className="btn" disabled={busy} onClick={() => void exportTraining()}>
          导出训练候选记录
        </button>
      </div>
      {err && (
        <p role="alert" className="gateway-error">
          {err}
        </p>
      )}
      <div className="metrics gateway-metrics">
        {[
          ['已受理请求', data?.total ?? '—'],
          ['成功率', data?.total ? `${((100 * data.succeeded) / data.total).toFixed(1)}%` : '—'],
          [
            '输入 / 输出 Token',
            data
              ? `${data.inputTokens.toLocaleString()} / ${data.outputTokens.toLocaleString()}`
              : '—',
          ],
          ['平均耗时', data?.averageMs != null ? `${(data.averageMs / 1000).toFixed(2)}s` : '—'],
          ['当前并发', data?.active ?? '—'],
          ['失败 / 中断', data?.failed ?? '—'],
        ].map(([label, value]) => (
          <div className="metric" key={label}>
            <div className="metric-label">{label}</div>
            <div className="metric-value">{value}</div>
          </div>
        ))}
      </div>
      {!!data?.usageMissing && (
        <p className="muted">
          {data.usageMissing} 条成功调用未返回用量；流式请求可由客户端传入
          stream_options.include_usage（上游需支持）。
        </p>
      )}
      <div className="gateway-columns">
        <section className="card">
          <h3>每日调用 · UTC</h3>
          {data?.days.length ? (
            data.days.map((d) => (
              <div className="gateway-trend" key={d.day}>
                <span>{d.day}</span>
                <progress max={Math.max(...data.days.map((x) => x.total), 1)} value={d.total} />
                <span>
                  {d.total} 次 / 成功 {d.succeeded}
                </span>
              </div>
            ))
          ) : (
            <p className="muted">尚无调用记录</p>
          )}
        </section>
        <section className="card">
          <h3>近期错误</h3>
          {data?.errors.length ? (
            data.errors.map((e) => (
              <p key={e.errorCode}>
                <code>{e.errorCode}</code> · {e.count} 次
              </p>
            ))
          ) : (
            <p className="muted">暂无错误</p>
          )}
        </section>
      </div>
      <section className="card gateway-table">
        <h3>
          调用记录 <small className="muted">共 {calls.total} 条</small>
        </h3>
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>Key / 用户</th>
              <th>版本</th>
              <th>状态</th>
              <th>耗时</th>
              <th>Token 入 / 出</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {calls.rows.map((r) => (
              <tr key={r.id}>
                <td>{time(r.createdAt)}</td>
                <td>
                  <code>{r.keyPrefix}…</code>
                  <small className="gateway-small">{r.userId}</small>
                </td>
                <td>{tierLabel(r.tier)}</td>
                <td>
                  {r.status}
                  <small className="gateway-small">{r.errorCode}</small>
                </td>
                <td>{r.durationMs == null ? '—' : `${r.durationMs} ms`}</td>
                <td>
                  {r.inputTokens ?? '—'} / {r.outputTokens ?? '—'}
                </td>
                <td>
                  <button className="btn btn-sm" onClick={() => void showDetail(r.id)}>
                    详情
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!calls.rows.length && <p className="muted">该范围没有记录</p>}
        <div className="gateway-toolbar">
          <button
            className="btn"
            disabled={!offset}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            上一页
          </button>
          <span>
            {calls.total ? offset + 1 : 0}–{Math.min(offset + 50, calls.total)}
          </span>
          <button
            className="btn"
            disabled={offset + 50 >= calls.total}
            onClick={() => setOffset(offset + 50)}
          >
            下一页
          </button>
        </div>
      </section>
      {detail && (
        <section className="card">
          <div className="gateway-toolbar">
            <h3>调用详情</h3>
            <button className="btn" onClick={() => setDetail(null)}>
              关闭
            </button>
          </div>
          <p className="muted">
            请求中的历史由客户端提供；输出来自本次上游响应。身份为申请 Key 时快照。
          </p>
          {[
            'id',
            'identity',
            'verification',
            'verifiedPhone',
            'model',
            'promptVersion',
            'status',
            'errorCode',
            'request',
            'upstreamRequest',
            'outputText',
            'response',
            'usage',
          ].map((k) => (
            <details key={k} open={['identity', 'request', 'outputText'].includes(k)}>
              <summary>{k}</summary>
              <pre>{pretty(detail[k]) || '—'}</pre>
            </details>
          ))}
        </section>
      )}
      {settings && config && (
        <section className="card">
          <h3>网关设置</h3>
          <p className="muted">
            短信申请未开放。调用额度按 UTC 日累计；换 Key
            不重置账号额度。上游选择独立于原聊天主模型。
          </p>
          <div className="gateway-form">
            <label>
              启用 API
              <select
                value={String(settings.enabled)}
                onChange={(e) => setSettings({ ...settings, enabled: e.target.value === 'true' })}
              >
                <option value="true">启用</option>
                <option value="false">暂停</option>
              </select>
            </label>
            <label>
              Gemini 上游
              <select
                value={settings.upstreamId}
                onChange={(e) => setSettings({ ...settings, upstreamId: e.target.value })}
              >
                <option value={settings.upstreamId}>{settings.upstreamId}</option>
                {config.upstreams
                  .filter((u) => u.id !== settings.upstreamId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name} · {u.model}
                      {u.ready ? '' : '（不可用）'}
                    </option>
                  ))}
              </select>
            </label>
            {(
              [
                ['accountDailyLimit', '账号每日请求数'],
                ['accountRpm', '账号每分钟请求数'],
                ['accountConcurrency', '账号并发上限'],
                ['timeoutSeconds', '请求总超时（秒）'],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type="number"
                  min="1"
                  value={settings[key]}
                  onChange={(e) => setSettings({ ...settings, [key]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <button className="btn btn-primary" disabled={busy} onClick={saveSettings}>
            保存设置
          </button>
        </section>
      )}
    </div>
  );
}

export function ApiGatewayKeys() {
  const { success, error } = useToast();
  const [keys, setKeys] = useState<ApiKeyView[]>([]);
  const [users, setUsers] = useState<{ id: string; name: string; phone: string; email: string }[]>(
    [],
  );
  const [filter, setFilter] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState('');
  const [editing, setEditing] = useState<ApiKeyView | null>(null);
  const [input, setInput] = useState({
    userId: '',
    name: '',
    tier: 'pure' as ApiTier,
    dailyLimit: 100,
    rpm: 20,
    concurrency: 2,
    expiresAt: '',
  });
  const load = useCallback(async () => {
    try {
      const [k, u] = await Promise.all([
        api.get<{ keys: ApiKeyView[] }>(`${root}/keys`),
        api.get<{ users: typeof users }>(`${root}/users`),
      ]);
      setKeys(k.keys);
      setUsers(u.users);
      setErr('');
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function create() {
    setBusy(true);
    setSecret('');
    try {
      const r = await api.post<{ secret: string }>(`${root}/keys`, {
        ...input,
        expiresAt: input.expiresAt ? new Date(input.expiresAt).toISOString() : undefined,
      });
      setSecret(r.secret);
      success('测试 Key 已创建，明文仅此一次展示');
      await load();
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function patch(id: string, body: unknown) {
    setBusy(true);
    try {
      await api.patch(`${root}/keys/${id}`, body);
      success('Key 已更新');
      setEditing(null);
      await load();
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gateway-panel">
      <Intro title="Key 管理">
        按验证码绑定手机号分类，每个手机号最多一个未撤销
        Key，纯净版和高级版共用名额。短信未开放，当前仅签发管理员测试 Key。
      </Intro>
      {err && (
        <p role="alert" className="gateway-error">
          {err}
        </p>
      )}
      <section className="card">
        <h3>签发测试 Key</h3>
        <p className="muted">
          测试专用：每账号最多两个未撤销且未过期的测试
          Key。单列为未验证手机号，不代表正式绑定，也不纳入训练导出。
        </p>
        <div className="gateway-form">
          <label>
            所属账号
            <select
              value={input.userId}
              onChange={(e) => setInput({ ...input, userId: e.target.value })}
            >
              <option value="">选择注册账号</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name || '未命名'} · {u.email || u.phone || u.id}
                </option>
              ))}
            </select>
          </label>
          <label>
            Key 名称（必填）
            <input
              required
              value={input.name}
              maxLength={80}
              onChange={(e) => setInput({ ...input, name: e.target.value })}
            />
          </label>
          <label>
            版本
            <select
              value={input.tier}
              onChange={(e) => setInput({ ...input, tier: e.target.value as ApiTier })}
            >
              <option value="pure">纯净版</option>
              <option value="advanced">高级版</option>
            </select>
          </label>
          {(
            [
              ['dailyLimit', '每日请求数'],
              ['rpm', '每分钟请求数'],
              ['concurrency', '并发上限'],
            ] as const
          ).map(([k, label]) => (
            <label key={k}>
              {label}
              <input
                type="number"
                min="1"
                value={input[k]}
                onChange={(e) => setInput({ ...input, [k]: Number(e.target.value) })}
              />
            </label>
          ))}
          <label>
            到期时间（可选）
            <input
              type="datetime-local"
              value={input.expiresAt}
              onChange={(e) => setInput({ ...input, expiresAt: e.target.value })}
            />
          </label>
        </div>
        <button
          className="btn btn-primary"
          disabled={busy || !input.userId || !input.name.trim()}
          onClick={create}
        >
          创建测试 Key
        </button>
        {secret && (
          <div className="gateway-secret">
            <strong>立即保存，关闭后无法再次查看</strong>
            <code>{secret}</code>
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard
                  .writeText(secret)
                  .then(() => success('已复制'))
                  .catch(() => error('复制失败，请手动复制'));
              }}
            >
              复制
            </button>
            <button className="btn" onClick={() => setSecret('')}>
              已保存，隐藏
            </button>
          </div>
        )}
      </section>
      <div className="gateway-toolbar">
        <label>
          版本
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">全部</option>
            <option value="pure">纯净版</option>
            <option value="advanced">高级版</option>
          </select>
        </label>
        <button className="btn" onClick={() => void load()}>
          刷新
        </button>
      </div>
      <section className="card gateway-table">
        <table>
          <thead>
            <tr>
              <th>名称 / Key</th>
              <th>账号</th>
              <th>版本</th>
              <th>验证 / 状态</th>
              <th>今日 / 日限额</th>
              <th>累计 / 最近使用</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {groupKeysByPhone(keys.filter((k) => !filter || k.tier === filter)).map((group) => (
              <Fragment key={group.phone}>
                <tr className="gateway-phone-row">
                  <th colSpan={7} scope="colgroup">
                    验证码绑定手机号：{group.phone}
                  </th>
                </tr>
                {group.keys.map((k) => (
                  <tr key={k.id}>
                    <td>
                      {k.name}
                      <small className="gateway-small">{k.prefix}…</small>
                    </td>
                    <td>
                      {users.find((u) => u.id === k.userId)?.name || k.userId}
                      <small className="gateway-small">{k.userId}</small>
                    </td>
                    <td>{tierLabel(k.tier)}</td>
                    <td>
                      {k.verification === 'admin_test' ? '管理员测试' : k.verifiedPhone}
                      <small className="gateway-small">
                        {k.expiresAt && Date.parse(k.expiresAt) <= Date.now()
                          ? 'expired'
                          : k.status}
                      </small>
                    </td>
                    <td>
                      {k.todayCalls} / {k.dailyLimit}
                    </td>
                    <td>
                      {k.totalCalls}
                      <small className="gateway-small">{time(k.lastUsedAt)}</small>
                    </td>
                    <td>
                      <div className="gateway-actions">
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            sessionStorage.setItem('gateway.filterKey', k.id);
                            window.location.hash = 'api-overview';
                          }}
                        >
                          记录
                        </button>
                        <button
                          className="btn btn-sm"
                          disabled={busy || k.status === 'revoked'}
                          onClick={() => setEditing(k)}
                        >
                          额度
                        </button>
                        <button
                          className="btn btn-sm"
                          disabled={busy || k.status === 'revoked'}
                          onClick={() =>
                            void patch(k.id, {
                              status: k.status === 'active' ? 'disabled' : 'active',
                            })
                          }
                        >
                          {k.status === 'active' ? '停用' : '启用'}
                        </button>
                        <button
                          className="btn btn-sm btn-danger"
                          disabled={busy || k.status === 'revoked'}
                          onClick={() => {
                            if (confirm(`撤销 ${k.name}？此 Key 无法恢复。`))
                              void patch(k.id, { status: 'revoked' });
                          }}
                        >
                          撤销
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!keys.length && <p className="muted">尚未签发 Key</p>}
      </section>
      {editing && (
        <section className="card">
          <h3>调整 {editing.name}</h3>
          <div className="gateway-form">
            {(
              [
                ['dailyLimit', '每日请求数'],
                ['rpm', '每分钟请求数'],
                ['concurrency', '并发上限'],
              ] as const
            ).map(([k, label]) => (
              <label key={k}>
                {label}
                <input
                  type="number"
                  min="1"
                  value={editing[k]}
                  onChange={(e) => setEditing({ ...editing, [k]: Number(e.target.value) })}
                />
              </label>
            ))}
          </div>
          <div className="gateway-actions">
            <button
              className="btn btn-primary"
              disabled={busy}
              onClick={() =>
                void patch(editing.id, {
                  dailyLimit: editing.dailyLimit,
                  rpm: editing.rpm,
                  concurrency: editing.concurrency,
                })
              }
            >
              保存
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

export function ApiGatewayPrelude() {
  const { success, error } = useToast();
  const [state, setState] = useState<ApiPreludeView | null>(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const dirty = !!state && draft !== state.draft;
  useEffect(() => {
    void api
      .get<ApiPreludeView>(`${root}/prelude`)
      .then((r) => {
        setState(r);
        setDraft(r.draft);
      })
      .catch((e) => setErr(e.message));
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const fn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', fn);
    return () => window.removeEventListener('beforeunload', fn);
  }, [dirty]);
  async function action(kind: 'save' | 'publish' | 'rollback', versionId?: number) {
    if (!state) return;
    if (
      kind !== 'save' &&
      !confirm(
        kind === 'publish'
          ? '发布当前已保存草稿？从下一次高级版调用开始生效。'
          : `发布历史版本 ${versionId} 的内容？当前草稿保留。`,
      )
    )
      return;
    setBusy(true);
    try {
      const next =
        kind === 'save'
          ? await api.put<ApiPreludeView>(`${root}/prelude/draft`, {
              content: draft,
              revision: state.revision,
            })
          : await api.post<ApiPreludeView>(`${root}/prelude/${kind}`, {
              revision: state.revision,
              ...(versionId ? { versionId } : {}),
            });
      setState(next);
      if (kind === 'save') setDraft(next.draft);
      success(kind === 'save' ? '草稿已保存，线上未改变' : '已发布，下一次高级版调用生效');
    } catch (e) {
      error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gateway-panel">
      <Intro title="高级版前置">
        只作用于高级版 API。保存草稿不会影响线上；发布和回滚保留不可变版本。
      </Intro>
      {err && (
        <p role="alert" className="gateway-error">
          {err}
        </p>
      )}
      {state && (
        <>
          <section className="card">
            <div className="gateway-toolbar">
              <strong>
                线上版本：
                {state.publishedId ? `v${state.publishedId}` : '尚未发布（高级版调用暂不可用）'}
              </strong>
              <span className="muted">
                草稿修订 {state.revision}
                {dirty ? ' · 有未保存内容' : ''}
              </span>
            </div>
            <p className="muted">
              初始草稿为一般表达与去模板化规则；未导入原文件的露骨性描写及模式解锁段落。
            </p>
            <textarea
              className="gateway-editor"
              aria-label="高级版前置草稿"
              value={draft}
              maxLength={50000}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div className="gateway-toolbar">
              <button
                className="btn"
                disabled={busy || !dirty || !draft.trim()}
                onClick={() => void action('save')}
              >
                保存草稿
              </button>
              <button
                className="btn btn-primary"
                disabled={busy || dirty || !draft.trim()}
                onClick={() => void action('publish')}
              >
                发布已保存草稿
              </button>
              <span className="muted">{draft.length.toLocaleString()} 字符</span>
            </div>
          </section>
          <section className="card">
            <h3>历史版本</h3>
            {state.versions.map((v) => (
              <details key={v.id}>
                <summary>
                  v{v.id} · {time(v.createdAt)} · {v.source}
                  {v.id === state.publishedId ? ' · 当前线上' : ''}
                </summary>
                <pre>{v.content}</pre>
                <small className="muted">SHA-256: {v.hash}</small>
                <p>
                  <button
                    className="btn"
                    disabled={busy || dirty || v.id === state.publishedId}
                    onClick={() => void action('rollback', v.id)}
                  >
                    回滚到此内容
                  </button>
                </p>
              </details>
            ))}
            {!state.versions.length && <p className="muted">尚无发布记录</p>}
          </section>
        </>
      )}
    </div>
  );
}
