import { useCallback, useEffect, useState } from 'react';
import { Server, Circle, CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import { api } from '../api/client';
import { useToast } from '../components/Toast';
import { formatDateTime } from '../lib/datetime';

interface AdminServerInfo {
  mode: string;
  now: string;
  port: number;
  host: string;
  enableAdminConsole: boolean;
  narrativeBoundaryGlobal: number;
  freeLimitOverride: number | null;
}

interface LlmInfo {
  hasReady: boolean;
  providers: { name: string; ready: boolean }[];
}

interface SidecarInfo {
  ready: boolean;
  model: string;
  baseUrl: string;
}

interface Counts {
  users: number;
  sessions: number;
  messages: number;
  candleLedger: number;
  conversationLogs: number;
  ifCodes: number;
  ifRedemptions: number;
  payments: number;
  surveysSubs: number;
  promptVersions: number;
  adminAudit: number;
}

interface AdminHealthData {
  server: AdminServerInfo;
  llm: LlmInfo;
  sidecar: SidecarInfo;
  counts: Counts;
  costsToday: { date: string; cost: number; tokens: number; calls: number };
}

interface PublicHealthData {
  ok?: boolean;
  name?: string;
  mode?: string;
  deploy?: {
    mode?: string;
    port?: number;
    enableAdminConsole?: boolean;
  };
  mockFallback?: {
    enabled?: boolean;
    baseUrl?: string | null;
    reachable?: boolean | null;
    status?: number | null;
  };
  llm?: LlmInfo;
  sidecar?: SidecarInfo;
}

interface DiagnosticsData {
  ts: string;
  summary: { pass: number; warn: number; fail: number; total: number };
  checks: Array<{
    id: string;
    label: string;
    status: 'pass' | 'warn' | 'fail';
    hint: string;
    fixHint?: string;
  }>;
}

interface HealthState {
  publicHealth: PublicHealthData | null;
  adminHealth: AdminHealthData | null;
  diagnostics: DiagnosticsData | null;
  errors: {
    publicHealth?: string;
    adminHealth?: string;
    diagnostics?: string;
  };
}

const formatTime = formatDateTime;

function statusBadge(status: 'pass' | 'warn' | 'fail') {
  if (status === 'pass') return <span className="badge badge-ok">pass</span>;
  if (status === 'fail') return <span className="badge badge-danger">fail</span>;
  return <span className="badge badge-warn">warn</span>;
}

function statusIcon(status: 'pass' | 'warn' | 'fail') {
  if (status === 'pass') return <CheckCircle size={16} style={{ color: 'var(--ok)' }} />;
  if (status === 'fail') return <XCircle size={16} style={{ color: 'var(--danger)' }} />;
  return <Circle size={16} style={{ color: 'var(--gold-light)' }} />;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function publicMode(data: PublicHealthData | null) {
  if (!data) return '—';
  return data.deploy?.mode ?? data.mode ?? (data.name === 'yelan-server' ? 'server' : 'local');
}

export function Health() {
  const { error: toastErr } = useToast();
  const [state, setState] = useState<HealthState>({
    publicHealth: null,
    adminHealth: null,
    diagnostics: null,
    errors: {},
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    const [publicResult, adminResult, diagnosticsResult] = await Promise.allSettled([
      api.get<PublicHealthData>('/health'),
      api.get<AdminHealthData>('/api/admin/health'),
      api.get<DiagnosticsData>('/api/admin/diagnostics'),
    ]);

    const next: HealthState = {
      publicHealth: publicResult.status === 'fulfilled' ? publicResult.value : null,
      adminHealth: adminResult.status === 'fulfilled' ? adminResult.value : null,
      diagnostics: diagnosticsResult.status === 'fulfilled' ? diagnosticsResult.value : null,
      errors: {
        publicHealth: publicResult.status === 'rejected' ? errorMessage(publicResult.reason) : undefined,
        adminHealth: adminResult.status === 'rejected' ? errorMessage(adminResult.reason) : undefined,
        diagnostics: diagnosticsResult.status === 'rejected' ? errorMessage(diagnosticsResult.reason) : undefined,
      },
    };

    setState(next);
    setLoading(false);
    setRefreshing(false);

    if (!next.publicHealth && !next.adminHealth && !next.diagnostics) {
      toastErr('健康检查接口全部不可用');
    }
  }, [toastErr]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <div className="state-placeholder"><Server size={32} /><span>加载健康数据...</span></div>;
  }

  const publicStatus: 'pass' | 'warn' | 'fail' = state.publicHealth
    ? state.publicHealth.ok === false ? 'warn' : 'pass'
    : 'fail';
  const adminStatus: 'pass' | 'warn' | 'fail' = state.adminHealth ? 'pass' : 'fail';
  const diagnosticsStatus: 'pass' | 'warn' | 'fail' = state.diagnostics
    ? state.diagnostics.summary.fail > 0 ? 'fail' : state.diagnostics.summary.warn > 0 ? 'warn' : 'pass'
    : 'fail';
  const d = state.adminHealth;
  const publicSidecar = state.publicHealth?.sidecar;
  const sidecar = d?.sidecar ?? publicSidecar;
  const llm = d?.llm ?? state.publicHealth?.llm;
  const fallback = state.publicHealth?.mockFallback;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2 style={{ marginBottom: 0 }}>健康检查</h2>
        <button className="btn" onClick={load} disabled={refreshing} title="重新调用健康接口">
          <RefreshCw size={14} /> {refreshing ? '刷新中...' : '刷新'}
        </button>
      </div>
      <p style={{ color: 'var(--paper-dim)', marginBottom: 16, fontSize: 14 }}>
        实时调用公开健康、后台聚合和诊断接口，确认服务、鉴权、LLM、sidecar 与本地状态。
      </p>

      <div className="card">
        <h3>接口探测</h3>
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
          <div className="metric">
            <div className="metric-label">公开 /health</div>
            <div className="metric-value">{statusIcon(publicStatus)}</div>
            <div className="metric-detail">{state.errors.publicHealth ?? state.publicHealth?.name ?? '可达'}</div>
          </div>
          <div className="metric">
            <div className="metric-label">后台 /api/admin/health</div>
            <div className="metric-value">{statusIcon(adminStatus)}</div>
            <div className="metric-detail">{state.errors.adminHealth ?? '已返回聚合状态'}</div>
          </div>
          <div className="metric">
            <div className="metric-label">诊断 /api/admin/diagnostics</div>
            <div className="metric-value">{statusIcon(diagnosticsStatus)}</div>
            <div className="metric-detail">
              {state.errors.diagnostics
                ?? `${state.diagnostics?.summary.pass ?? 0} pass / ${state.diagnostics?.summary.warn ?? 0} warn / ${state.diagnostics?.summary.fail ?? 0} fail`}
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>服务器</h3>
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
          <div className="metric">
            <div className="metric-label">部署模式</div>
            <div className="metric-value">{d?.server.mode ?? publicMode(state.publicHealth)}</div>
          </div>
          <div className="metric">
            <div className="metric-label">运行端口</div>
            <div className="metric-value">{d?.server.port ?? state.publicHealth?.deploy?.port ?? '—'}</div>
          </div>
          <div className="metric">
            <div className="metric-label">管理后台</div>
            <div className="metric-value">
              {d ? (
                <span className={`badge ${d.server.enableAdminConsole ? 'badge-ok' : 'badge-warn'}`}>
                  {d.server.enableAdminConsole ? '启用' : '禁用'}
                </span>
              ) : (
                <span className={`badge ${state.publicHealth?.deploy?.enableAdminConsole ? 'badge-ok' : 'badge-warn'}`}>
                  {state.publicHealth?.deploy?.enableAdminConsole ? '启用' : '未知'}
                </span>
              )}
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">全局合规边界</div>
            <div className="metric-value">{d ? `B${d.server.narrativeBoundaryGlobal}` : '—'}</div>
          </div>
          <div className="metric">
            <div className="metric-label">免费限制覆盖</div>
            <div className="metric-value">{d?.server.freeLimitOverride ?? '默认'}</div>
          </div>
          <div className="metric">
            <div className="metric-label">服务器时间</div>
            <div className="metric-value" style={{ fontSize: 12 }}>{d ? formatTime(d.server.now) : '—'}</div>
          </div>
        </div>
        {fallback?.enabled && (
          <div className="metric-detail">
            mock fallback：{fallback.reachable ? '可达' : '不可达'} · {fallback.status ?? 'no status'} · {fallback.baseUrl}
          </div>
        )}
      </div>

      <div className="card">
        <h3>LLM</h3>
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(2, 1fr)', marginBottom: 16 }}>
          <div className="metric">
            <div className="metric-label">有可用 Provider</div>
            <div className="metric-value">
              {llm?.hasReady ? <CheckCircle size={18} style={{ color: 'var(--ok)' }} /> : <XCircle size={18} style={{ color: 'var(--danger)' }} />}
            </div>
          </div>
        </div>
        <table>
          <thead>
            <tr><th>Provider</th><th>状态</th></tr>
          </thead>
          <tbody>
            {(llm?.providers ?? []).map((p) => (
              <tr key={p.name}>
                <td style={{ fontFamily: 'var(--font-mono)' }}>{p.name}</td>
                <td><span className={`badge ${p.ready ? 'badge-ok' : 'badge-warn'}`}>{p.ready ? 'ready' : 'not ready'}</span></td>
              </tr>
            ))}
            {!llm?.providers?.length && (
              <tr><td colSpan={2} style={{ color: 'var(--paper-dim)' }}>未返回 provider 列表</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Sidecar</h3>
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="metric">
            <div className="metric-label">状态</div>
            <div className="metric-value">
              <span className={`badge ${sidecar?.ready ? 'badge-ok' : 'badge-warn'}`}>{sidecar?.ready ? '就绪' : '未就绪'}</span>
            </div>
          </div>
          <div className="metric">
            <div className="metric-label">模型</div>
            <div className="metric-value" style={{ fontFamily: 'var(--font-mono)', fontSize: 13 }}>{sidecar?.model ?? '—'}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Base URL</div>
            <div className="metric-value" style={{ fontFamily: 'var(--font-mono)', fontSize: 12, overflowWrap: 'anywhere' }}>{sidecar?.baseUrl ?? '—'}</div>
          </div>
        </div>
      </div>

      {d && (
        <div className="card">
        <h3>数据统计</h3>
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 16 }}>
          <div className="metric">
            <div className="metric-label">用户</div>
            <div className="metric-value">{d.counts.users}</div>
          </div>
          <div className="metric">
            <div className="metric-label">会话</div>
            <div className="metric-value">{d.counts.sessions}</div>
          </div>
          <div className="metric">
            <div className="metric-label">消息</div>
            <div className="metric-value">{d.counts.messages}</div>
          </div>
          <div className="metric">
            <div className="metric-label">烛账流水</div>
            <div className="metric-value">{d.counts.candleLedger}</div>
          </div>
          <div className="metric">
            <div className="metric-label">对话日志</div>
            <div className="metric-value">{d.counts.conversationLogs}</div>
          </div>
          <div className="metric">
            <div className="metric-label">IF 暗号</div>
            <div className="metric-value">{d.counts.ifCodes}</div>
          </div>
          <div className="metric">
            <div className="metric-label">IF 兑换</div>
            <div className="metric-value">{d.counts.ifRedemptions}</div>
          </div>
          <div className="metric">
            <div className="metric-label">支付记录</div>
            <div className="metric-value">{d.counts.payments}</div>
          </div>
          <div className="metric">
            <div className="metric-label">问卷提交</div>
            <div className="metric-value">{d.counts.surveysSubs}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Prompt 版本</div>
            <div className="metric-value">{d.counts.promptVersions}</div>
          </div>
        </div>
        </div>
      )}

      {d && (
        <div className="card">
        <h3>今日成本</h3>
        <div className="metrics" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <div className="metric">
            <div className="metric-label">调用</div>
            <div className="metric-value">{d.costsToday.calls}</div>
          </div>
          <div className="metric">
            <div className="metric-label">Tokens</div>
            <div className="metric-value">{d.costsToday.tokens}</div>
          </div>
          <div className="metric">
            <div className="metric-label">成本</div>
            <div className="metric-value">${d.costsToday.cost.toFixed(6)}</div>
          </div>
        </div>
        </div>
      )}

      {state.diagnostics && (
        <div className="card">
          <h3>诊断清单</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {state.diagnostics.checks.map((check) => (
              <div
                key={check.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '10px 14px', borderRadius: 8,
                  background: check.status === 'fail' ? 'var(--danger-bg, rgba(220,38,38,0.08))'
                    : check.status === 'warn' ? 'var(--warn-bg, rgba(234,179,8,0.08))'
                    : 'var(--surface)',
                }}
              >
                {statusIcon(check.status)}
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 500 }}>{check.label}</span>
                    {statusBadge(check.status)}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--paper-dim)', marginTop: 2 }}>{check.hint}</div>
                  {check.fixHint && <div style={{ fontSize: 12, color: 'var(--gold-light)', marginTop: 2 }}>{check.fixHint}</div>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--paper-dim)', marginTop: 12 }}>
        数据时间：{d ? formatTime(d.server.now) : state.diagnostics ? formatTime(state.diagnostics.ts) : '—'}
      </div>
    </div>
  );
}
