import { useState, useEffect, useCallback } from 'react';
import { Circle, RefreshCw, Power } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { useToast } from './Toast';
import { getBase, getToken, setBase, setToken, api } from '../api/client';

interface Props {
  currentHash: string;
  onNavigate: (hash: string, legacy?: boolean) => void;
  children: React.ReactNode;
}

interface ReloadConfigResponse {
  envApplied?: number;
  readyProviders?: string[];
}

interface PublicHealthResponse {
  ok?: boolean;
  name?: string;
  mode?: string;
  deploy?: { mode?: string };
  mockFallback?: { enabled?: boolean; reachable?: boolean | null };
}

function getModeLabel(data: PublicHealthResponse): string {
  if (data.deploy?.mode) return data.deploy.mode;
  if (data.mode) return data.mode;
  if (data.name === 'yelan-server') {
    if (!data.mockFallback?.enabled) return 'server';
    return data.mockFallback.reachable ? 'server+fallback' : 'server:fallback-down';
  }
  return data.ok === false ? '异常' : 'local';
}

export function Shell({ currentHash, onNavigate, children }: Props) {
  const [baseUrl, setBaseUrl] = useState(getBase());
  const [tok, setTok] = useState(getToken());
  const [ok, setOk] = useState<boolean | null>(null);
  const [modeLabel, setModeLabel] = useState('…');
  const [reloading, setReloading] = useState(false);
  const [killing, setKilling] = useState(false);
  const { success, error: toastErr } = useToast();

  const testConn = useCallback(async () => {
    try {
      const data = await api.get<PublicHealthResponse>('/health');
      setModeLabel(getModeLabel(data));
      await api.get('/api/admin/health');
      setOk(true);
    } catch {
      setOk(false);
      setModeLabel('离线');
    }
  }, []);

  useEffect(() => { testConn(); }, [testConn]);

  const handleBaseChange = (v: string) => {
    setBaseUrl(v);
    setBase(v);
  };
  const applyBasePreset = (preset: string) => {
    if (preset === 'custom') return;
    const next = preset === 'origin' ? window.location.origin : preset;
    handleBaseChange(next);
    setTimeout(testConn, 0);
  };
  const handleTokenChange = (v: string) => {
    setTok(v);
    setToken(v);
  };
  const handleBlur = () => { testConn(); };

  const reloadConfig = useCallback(async () => {
    setReloading(true);
    try {
      const r = await api.post<ReloadConfigResponse>('/api/admin/diagnostics/reload-config');
      success(`配置已重载 · ${r.envApplied ?? 0} env 更新 · ${r.readyProviders?.length ?? 0} provider ready`);
      testConn();
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setReloading(false);
    }
  }, [success, toastErr, testConn]);

  const shutdownBackend = useCallback(async () => {
    if (!window.confirm('关停后端服务进程？前端会立即失去连接，下次需重新启动 pnpm dev:mock。')) return;
    setKilling(true);
    try {
      await api.post('/api/admin/diagnostics/shutdown');
      success('后端已收到关停指令 — 进程即将退出');
      setOk(false);
      setModeLabel('离线');
    } catch (e) {
      toastErr((e as Error).message);
    } finally {
      setKilling(false);
    }
  }, [success, toastErr]);

  return (
    <div className="app-shell">
      <div className="topbar">
        <span className="topbar-brand">夜阑<small>运营后台</small></span>
        <span className="pill" style={{ fontFamily: 'var(--font-mono)', fontSize: 10 }} title="点击测试连接" onClick={testConn}>
          {modeLabel}
        </span>
        <button
          className="btn btn-sm"
          onClick={reloadConfig}
          disabled={reloading}
          title="重载配置：重读 .env、清 flag 缓存、重建 LLM router（不重启进程）"
        >
          <RefreshCw size={13} /> {reloading ? '重载中…' : '重载配置'}
        </button>
        <button
          className="btn btn-sm btn-danger"
          onClick={shutdownBackend}
          disabled={killing}
          title="关停后端：杀掉 Node 服务进程（含 tsx watch 父进程），停服防止遗留进程。仅 local 模式可用。"
        >
          <Power size={13} /> {killing ? '关停中…' : '关停后端'}
        </button>
        <span className="topbar-spacer" />
        <div className={`topbar-conn${ok === true ? ' ok' : ok === false ? ' err' : ''}`}>
          <Circle className="dot" size={8} />
          <span>{ok === true ? '已连接' : ok === false ? '未连接' : '检测中…'}</span>
        </div>
        <input
          className="token-input"
          type="password"
          value={tok}
          onChange={(e) => handleTokenChange(e.target.value)}
          onBlur={handleBlur}
          placeholder="Admin Token"
        />
        <select
          value={baseUrl === 'http://127.0.0.1:8787' ? baseUrl : baseUrl === window.location.origin ? 'origin' : 'custom'}
          onChange={(e) => applyBasePreset(e.target.value)}
          title="API 快速切换"
        >
          <option value="http://127.0.0.1:8787">local</option>
          <option value="origin">same origin</option>
          <option value="custom">custom</option>
        </select>
        <input
          value={baseUrl}
          onChange={(e) => handleBaseChange(e.target.value)}
          onBlur={handleBlur}
          placeholder="http://localhost:8787"
        />
      </div>
      <Sidebar current={currentHash} onNavigate={onNavigate} />
      <main className="main">{children}</main>
    </div>
  );
}
