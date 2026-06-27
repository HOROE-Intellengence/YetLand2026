import { Component, useState, useCallback, useEffect, Suspense, type ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Shell } from './components/Shell';
import { getBase } from './api/client';
import { ROUTES } from './routes/registry';

function Fallback() {
  return <div className="state-placeholder"><span>加载面板...</span></div>;
}

interface RouteErrorBoundaryProps {
  route: string;
  onNavigate: (hash: string) => void;
  children: ReactNode;
}

interface RouteErrorBoundaryState {
  error: Error | null;
}

class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  override state: RouteErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  override componentDidUpdate(prevProps: RouteErrorBoundaryProps) {
    if (prevProps.route !== this.props.route && this.state.error) {
      this.setState({ error: null });
    }
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="state-placeholder state-error">
        <span>面板加载失败：{this.props.route}</span>
        <small>{this.state.error.message}</small>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn btn-sm" onClick={() => this.setState({ error: null })}>重试</button>
          <button className="btn btn-sm btn-primary" onClick={() => this.props.onNavigate('overview')}>回到总览</button>
        </div>
      </div>
    );
  }
}

interface LinkPanelAction {
  label: string;
  href: string;
  primary?: boolean;
}

interface LinkPanelProps {
  title: string;
  description: string;
  actions: LinkPanelAction[];
  notes?: string[];
}

function apiBase() {
  return getBase().replace(/\/$/, '');
}

function legacyUrl(hash: string) {
  return `${apiBase()}/admin-legacy#${hash}`;
}

function LinkPanel({ title, description, actions, notes }: LinkPanelProps) {
  return (
    <div className="link-panel">
      <div>
        <h1>{title}</h1>
        <p className="link-panel-desc">{description}</p>
      </div>
      <div className="link-actions">
        {actions.map((action) => (
          <a
            key={action.href}
            className={`btn${action.primary ? ' btn-primary' : ''}`}
            href={action.href}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={15} />
            {action.label}
          </a>
        ))}
      </div>
      {notes?.length ? (
        <div className="card">
          <h2>说明</h2>
          <ul className="note-list">
            {notes.map((note) => <li key={note}>{note}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function DbToolsPanel() {
  return (
    <LinkPanel
      title="DB 工具"
      description="数据库迁移和查询 GUI，服务于 infra/db 的 SQL migration，不是 mock 数据编辑器。"
      actions={[
        { label: '打开 DB GUI', href: 'http://localhost:5174', primary: true },
        { label: '打开旧说明', href: legacyUrl('db-tools') },
      ]}
      notes={[
        '使用前需要单独启动：pnpm db:gui。',
        '本地 api 的运行数据主要在 apps/api/.local/state.json，不在这个 GUI 里。',
        '真正改表结构时走 infra/db/migrations，不要手写临时 ALTER TABLE 糊过去。',
      ]}
    />
  );
}

export function App() {
  const [hash, setHash] = useState(() => window.location.hash.replace('#', '') || 'overview');

  useEffect(() => {
    const onHash = () => setHash(window.location.hash.replace('#', '') || 'overview');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const handleNavigate = useCallback((h: string, legacy?: boolean) => {
    if (legacy) {
      window.location.href = `/admin-legacy#${h}`;
      return;
    }
    window.location.hash = h;
  }, []);

  const def = ROUTES[hash];

  const panel = (() => {
    if (def?.component) {
      const LazyComp = def.component;
      return <Suspense fallback={<Fallback />}><LazyComp /></Suspense>;
    }
    if (hash === 'db-tools') return <DbToolsPanel />;
    return <div className="state-placeholder state-error"><span>未知面板：{hash}</span></div>;
  })();

  return (
    <Shell currentHash={hash} onNavigate={handleNavigate}>
      <RouteErrorBoundary route={hash} onNavigate={(next) => { window.location.hash = next; }}>
        {panel}
      </RouteErrorBoundary>
    </Shell>
  );
}
