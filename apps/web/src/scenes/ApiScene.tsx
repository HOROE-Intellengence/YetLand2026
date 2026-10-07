import { useEffect, useState } from 'react';
import type { ApiKeyView, ApiQuota, ApiTier } from '@yelan/shared';
import { api, getToken } from '../api/client';
import { useSessionStore } from '../stores/sessionStore';
import './ApiScene.css';

type Status = {
  baseUrl: string;
  smsEnabled: boolean;
  applicationEnabled: boolean;
  simulation?: boolean;
  message: string;
  keys: ApiKeyView[];
  quota: ApiQuota;
};
export function ApiScene() {
  const goOpening = useSessionStore((s) => s.goOpening);
  const goApiLogin = useSessionStore((s) => s.goApiLogin);
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState('');
  const [tier, setTier] = useState<ApiTier>('pure');
  const [keyName, setKeyName] = useState('');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [challengeId, setChallengeId] = useState('');
  const [issuedSecret, setIssuedSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  async function load() {
    setLoading(true);
    try {
      setData(await api<Status>('/api/developer'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (getToken()) void load();
  }, []);
  async function revoke(key: ApiKeyView) {
    if (!confirm(`撤销「${key.name}」？使用它的客户端将无法继续调用。`)) return;
    setBusy(true);
    try {
      await api(`/api/developer/keys/${key.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function sendCode() {
    setBusy(true);
    setError('');
    setChallengeId('');
    setCode('');
    try {
      const result = await api<{ challengeId: string }>('/api/developer/sms/send', {
        method: 'POST',
        body: JSON.stringify({ phone }),
      });
      setChallengeId(result.challengeId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function applyKey() {
    setBusy(true);
    setError('');
    try {
      const verified = await api<{ verificationId: string }>('/api/developer/sms/verify', {
        method: 'POST',
        body: JSON.stringify({ challengeId, code }),
      });
      setChallengeId('');
      setCode('');
      const result = await api<{ secret: string }>('/api/developer/keys', {
        method: 'POST',
        body: JSON.stringify({
          name: keyName.trim(),
          tier,
          verificationId: verified.verificationId,
        }),
      });
      setIssuedSecret(result.secret);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="api-scene">
      <div className="api-scene-inner">
        <button className="api-scene-back" onClick={goOpening}>
          ← 返回
        </button>
        <p className="api-scene-kicker">YETLAND · API</p>
        <h1>把夜阑接入你的客户端</h1>
        <p className="api-scene-lead">同一个地址，选择适合你的表达方式。版本由 Key 决定。</p>
        <div className="api-scene-tiers">
          {(
            [
              {
                value: 'pure',
                name: '纯净版',
                description: '直接连接 Gemini，保留你自己的提示词和对话上下文。',
              },
              {
                value: 'advanced',
                name: '高级版',
                description: '在 Gemini 基础上加入平台的表达规范。',
              },
            ] as const
          ).map((t) => (
            <button
              key={t.value}
              aria-pressed={tier === t.value}
              className={tier === t.value ? 'selected' : ''}
              onClick={() => setTier(t.value)}
            >
              <strong>{t.name}</strong>
              <span>{t.description}</span>
            </button>
          ))}
        </div>
        <section className="api-scene-card">
          <h2>连接地址</h2>
          <code>{data?.baseUrl ?? 'https://yetland.cn/v1'}</code>
          <p>
            客户端选择 Chat Completions 接口；完整路径为 <code>/v1/chat/completions</code>。
          </p>
          <p>
            上下文由客户端发送，API
            不提供聊天云同步。调用内容保存在服务器；开放申请时将说明保存和训练授权规则。
          </p>
        </section>
        <section className="api-scene-card">
          <h2>申请 {tier === 'pure' ? '纯净版' : '高级版'} Key</h2>
          {data?.simulation && (
            <p role="status">
              隔离演练：验证码和模型回复均为模拟，记录保存在演练库且不自动清理，不发送真实短信。
            </p>
          )}
          <label className="api-scene-field">
            Key 名称（必填）
            <input
              required
              maxLength={80}
              placeholder="例如：我的聊天客户端"
              value={keyName}
              onChange={(e) => setKeyName(e.target.value)}
            />
          </label>
          <p>
            每个验证码绑定手机号最多一个
            Key，纯净版和高级版共用名额。停用、过期仍占名额，撤销后可重新验证申请。
          </p>
          {data?.applicationEnabled ? (
            <>
              <label className="api-scene-field">
                验证码绑定手机号
                <input
                  value={phone}
                  disabled={busy}
                  inputMode="tel"
                  onChange={(e) => {
                    setPhone(e.target.value);
                    setChallengeId('');
                    setCode('');
                  }}
                />
              </label>
              <button
                disabled={busy || !phone.trim() || !keyName.trim()}
                onClick={() => void sendCode()}
              >
                发送验证码
              </button>
              {challengeId && (
                <>
                  <p role="status">验证码已发送，请输入六位验证码。</p>
                  <label className="api-scene-field">
                    验证码
                    <input
                      value={code}
                      disabled={busy}
                      inputMode="numeric"
                      maxLength={6}
                      onChange={(e) => setCode(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={busy || !/^\d{6}$/.test(code) || !keyName.trim()}
                    onClick={() => void applyKey()}
                  >
                    {busy ? '申请中…' : '验证并创建 Key'}
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <p>
                申请前需登录、填写名称并验证手机号。短信验证暂未开放，申请入口将在服务开通后启用。
              </p>
              <button disabled>短信验证暂未开放</button>
            </>
          )}
          {issuedSecret && (
            <div className="api-scene-card">
              <p>Key 已创建。明文仅此一次展示，请立即保存。</p>
              <code>{issuedSecret}</code>
              <p>
                <button onClick={() => setIssuedSecret('')}>已保存，隐藏</button>
              </p>
            </div>
          )}
          {!data && <button onClick={goApiLogin}>登录 / 注册</button>}
        </section>
        {error && (
          <p role="alert" className="api-scene-error">
            {error}
          </p>
        )}
        {data && (
          <section className="api-scene-card" aria-label="API 额度">
            <h2>今日调用额度</h2>
            <dl className="api-scene-quota">
              <div>
                <dt>总额度</dt>
                <dd>{data.quota.total.toLocaleString()} 次</dd>
              </div>
              <div>
                <dt>已用</dt>
                <dd>{data.quota.used.toLocaleString()} 次</dd>
              </div>
              <div>
                <dt>剩余</dt>
                <dd>{data.quota.remaining.toLocaleString()} 次</dd>
              </div>
            </dl>
            <p>
              所有 Key 共用账号额度，同时受各 Key
              自身限额约束。已受理的调用（含失败和进行中）计入用量。
            </p>
            <p>
              下次重置：{new Date(data.quota.resetsAt).toLocaleString()}（本地时间；每日 UTC 00:00
              重置）
            </p>
            <button disabled={loading || busy} onClick={() => void load()}>
              {loading ? '刷新中…' : '刷新额度'}
            </button>
          </section>
        )}
        {data && (
          <section className="api-scene-card">
            <h2>我的 Key</h2>
            <p>这里只显示脱敏标识。Key 明文仅创建时提供，请妥善保管。</p>
            {data.keys.length ? (
              data.keys.map((k) => (
                <article className="api-scene-key" key={k.id}>
                  <div>
                    <strong>{k.name}</strong>
                    <span>
                      {k.tier === 'pure' ? '纯净版' : '高级版'} ·{' '}
                      {k.verification === 'admin_test'
                        ? '管理员测试'
                        : data.simulation
                          ? '模拟手机号核验'
                          : '手机号已验证'}
                    </span>
                    <code>{k.prefix}…</code>
                    <span>
                      {k.status} · 今日 {k.todayCalls}/{k.dailyLimit} 次
                    </span>
                    {k.expiresAt && <span>有效期至 {new Date(k.expiresAt).toLocaleString()}</span>}
                  </div>
                  <button disabled={busy || k.status === 'revoked'} onClick={() => void revoke(k)}>
                    撤销
                  </button>
                </article>
              ))
            ) : (
              <p>暂无 Key</p>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
