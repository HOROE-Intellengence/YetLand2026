import { useEffect, useState } from 'react';
import { CreditCard, Circle, AlertTriangle } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';

interface PayConfig {
  pay: Array<{ key: string; value: string; present: boolean; secret: boolean }>;
}

export function PayTest() {
  const { error: toastErr } = useToast();
  const [payKeys, setPayKeys] = useState<PayConfig['pay']>([]);
  const [paymentCount, setPaymentCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [cfg, health] = await Promise.all([
          api.get<{ env: PayConfig }>('/api/admin/config'),
          api.get<{ counts: { payments: number } }>('/api/admin/health'),
        ]);
        setPayKeys(cfg.env.pay);
        setPaymentCount(health.counts.payments);
        setErr('');
      } catch (e) {
        setErr((e as Error).message);
        toastErr('加载支付数据失败');
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return <div className="state-placeholder"><CreditCard size={32} /><span>加载支付数据...</span></div>;
  }
  if (err) {
    return <div className="state-placeholder state-error"><Circle size={32} /><span>{err}</span></div>;
  }

  return (
    <div>
      <h2 style={{ marginBottom: 16 }}>支付测试</h2>

      <div className="card" style={{ background: 'var(--warn-bg, rgba(234,179,8,0.08))', borderLeft: '3px solid var(--gold-light)' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <AlertTriangle size={18} style={{ color: 'var(--gold-light)', flexShrink: 0, marginTop: 2 }} />
          <div>
            <div style={{ fontWeight: 500, marginBottom: 4 }}>Mock-only 面板</div>
            <div style={{ fontSize: 13, color: 'var(--paper-dim)' }}>
              此面板仅用于本地 mock 环境测试支付流程。生产环境支付由 apps/server 的 /api/pay 路由处理（微信支付、支付宝、Stripe 回调）。
            </div>
          </div>
        </div>
      </div>

      <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginTop: 16 }}>
        <div className="metric">
          <div className="metric-label">支付记录数</div>
          <div className="metric-value">{paymentCount}</div>
        </div>
        <div className="metric">
          <div className="metric-label">微信支付</div>
          <div className="metric-value">
            <span className={`badge ${payKeys.find((k) => k.key === 'WECHAT_PAY_KEY')?.present ? 'badge-ok' : 'badge-warn'}`}>
              {payKeys.find((k) => k.key === 'WECHAT_PAY_KEY')?.present ? '已配置' : '未配置'}
            </span>
          </div>
        </div>
        <div className="metric">
          <div className="metric-label">支付宝</div>
          <div className="metric-value">
            <span className={`badge ${payKeys.find((k) => k.key === 'ALIPAY_PRIVATE_KEY')?.present ? 'badge-ok' : 'badge-warn'}`}>
              {payKeys.find((k) => k.key === 'ALIPAY_PRIVATE_KEY')?.present ? '已配置' : '未配置'}
            </span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>支付密钥状态</h3>
        <table>
          <thead>
            <tr><th>Key</th><th>状态</th><th>值（脱敏）</th></tr>
          </thead>
          <tbody>
            {payKeys.map((k) => (
              <tr key={k.key}>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>{k.key}</td>
                <td><span className={`badge ${k.present ? 'badge-ok' : 'badge-warn'}`}>{k.present ? '已配置' : '未配置'}</span></td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--paper-dim)' }}>{k.value || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h3>测试支付回调</h3>
        <p style={{ fontSize: 13, color: 'var(--paper-dim)', marginBottom: 12 }}>
          本地测试时可以用 curl 模拟支付回调通知：
        </p>
        <pre style={{ fontFamily: 'var(--font-mono)', fontSize: 11, background: 'var(--surface-alt)', padding: 12, borderRadius: 6, overflow: 'auto' }}>
{`# 模拟微信支付回调
curl -X POST http://localhost:8787/api/pay/wechat/notify \\
  -H "Content-Type: application/json" \\
  -d '{"out_trade_no":"pay_test_001","result_code":"SUCCESS"}'

# 模拟支付宝回调
curl -X POST http://localhost:8787/api/pay/alipay/notify \\
  -H "Content-Type: application/json" \\
  -d '{"out_trade_no":"pay_test_001","trade_status":"TRADE_SUCCESS"}'`}
        </pre>
      </div>
    </div>
  );
}
