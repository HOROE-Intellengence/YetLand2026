import type { ReactNode } from 'react';
import {
  LayoutDashboard, Server, Cpu, DollarSign, FileText,
  Users, Flame, Gauge, ScrollText, Key, MessageSquare,
  UserCheck, CreditCard, Database, Settings, Wrench, Brain,
  CheckCircle, Sparkles,
} from 'lucide-react';
import { isLegacyRoute } from '../routes/registry';

interface NavItem { label: string; hash: string; icon: ReactNode }

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: 'API 管理',
    items: [
      { label: '聊天记录', hash: 'api-overview', icon: <LayoutDashboard /> },
      { label: 'Key 管理', hash: 'api-keys', icon: <Key /> },
      { label: '高级版前置', hash: 'api-prelude', icon: <FileText /> },
    ],
  },
  {
    label: '监控',
    items: [
      { label: '一键向导', hash: 'setup', icon: <CheckCircle /> },
      { label: '总览', hash: 'overview', icon: <LayoutDashboard /> },
      { label: '健康检查', hash: 'health', icon: <Server /> },
      { label: '诊断', hash: 'diagnostics', icon: <Cpu /> },
      { label: '成本统计', hash: 'costs', icon: <DollarSign /> },
      { label: '审计日志', hash: 'audit', icon: <FileText /> },
    ],
  },
  {
    label: '配置',
    items: [
      { label: 'API 仓库', hash: 'config', icon: <Settings /> },
      { label: 'LLM 测试', hash: 'llm', icon: <Cpu /> },
      { label: '策略', hash: 'policy', icon: <ScrollText /> },
      { label: '会员', hash: 'membership', icon: <CreditCard /> },
      { label: '语音配置与测试', hash: 'voice-settings', icon: <MessageSquare /> },
      { label: '角色卡', hash: 'characters', icon: <UserCheck /> },
      { label: '星座编辑器', hash: 'constellations', icon: <Sparkles /> },
      { label: '前置提示卡', hash: 'prelude-cards', icon: <Wrench /> },
      { label: '系统提示编辑器', hash: 'prompts', icon: <FileText /> },
      { label: '侧袋 Prompt', hash: 'sidecar-prompts', icon: <Brain /> },
    ],
  },
  {
    label: '用户',
    items: [
      { label: '用户管理', hash: 'users', icon: <Users /> },
      { label: '会话', hash: 'sessions', icon: <MessageSquare /> },
      { label: '语音记录', hash: 'voice-records', icon: <MessageSquare /> },
      { label: '烛账', hash: 'candle', icon: <Flame /> },
      { label: '配额', hash: 'quota', icon: <Gauge /> },
      { label: 'IF 暗号', hash: 'if-codes', icon: <Key /> },
    ],
  },
  {
    label: '工具',
    items: [
      { label: '对话测试', hash: 'chat-test', icon: <MessageSquare /> },
      { label: 'DB 工具', hash: 'db-tools', icon: <Database /> },
      { label: '支付测试', hash: 'pay-test', icon: <CreditCard /> },
      { label: '问卷', hash: 'surveys', icon: <FileText /> },
    ],
  },
];

export function Sidebar({ current, onNavigate }: { current: string; onNavigate: (hash: string, legacy?: boolean) => void }) {
  return (
    <nav className="sidebar">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="sidebar-group">{group.label}</div>
          {group.items.map((item) => {
            const legacy = isLegacyRoute(item.hash);
            return (
              <button
                key={item.hash}
                className={`sidebar-link${current === item.hash ? ' active' : ''}`}
                onClick={() => onNavigate(item.hash, legacy)}
              >
                {item.icon}
                <span>{item.label}</span>
                {legacy && (
                  <span className="badge badge-warn" style={{ marginLeft: 'auto', fontSize: 9 }}>旧</span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

export { groups };
