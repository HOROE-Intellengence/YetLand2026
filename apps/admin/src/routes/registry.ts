import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

export interface RouteDef {
  hash: string;
  label: string;
  description?: string;
  /** Lazy-loaded native React component. Absent for legacy panels. */
  component?: LazyExoticComponent<ComponentType<unknown>>;
  /** True when this panel still redirects to old console.html */
  legacy?: boolean;
}

export const ROUTES: Record<string, RouteDef> = {
  // ── Native React panels ──────────────────────────────────────────────
  overview: {
    hash: 'overview', label: '总览',
    component: lazy(() => import('./Overview').then((m) => ({ default: m.Overview }))),
  },
  config: {
    hash: 'config', label: 'API 仓库',
    component: lazy(() => import('./ServiceConfig').then((m) => ({ default: m.ServiceConfig }))),
  },
  characters: {
    hash: 'characters', label: '角色卡',
    component: lazy(() => import('./Characters').then((m) => ({ default: m.Characters }))),
  },
  constellations: {
    hash: 'constellations', label: '星座编辑器',
    component: lazy(() => import('./ConstellationEditor').then((m) => ({ default: m.ConstellationEditor }))),
    description: '按角色可视化编辑介绍页星座（增删星点、连线），保存到独立存储；缺省回退内置默认。',
  },
  policy: {
    hash: 'policy', label: '策略',
    component: lazy(() => import('./Policy').then((m) => ({ default: m.Policy }))),
  },
  membership: {
    hash: 'membership', label: '会员',
    component: lazy(() => import('./Membership').then((m) => ({ default: m.Membership }))),
    description: '维护月光 / 星河 / 永夜的价格、折扣、赠烛和灰测人工开通。',
  },
  'prelude-cards': {
    hash: 'prelude-cards', label: '前置提示卡',
    component: lazy(() => import('./PreludeCards').then((m) => ({ default: m.PreludeCards }))),
  },
  prompts: {
    hash: 'prompts', label: '系统提示编辑器',
    component: lazy(() => import('./Prompts').then((m) => ({ default: m.Prompts }))),
    description: '编辑并发布主 AI 系统提示各段（系统模板 / 边界条款 B1–B5 / 阶段策略 / 角色卡）。发布即生效（下一轮对话），支持版本回滚。',
  },
  'sidecar-prompts': {
    hash: 'sidecar-prompts', label: '侧袋 Prompt',
    component: lazy(() => import('./SidecarPrompts').then((m) => ({ default: m.SidecarPrompts }))),
  },
  'if-codes': {
    hash: 'if-codes', label: 'IF 暗号',
    component: lazy(() => import('./IfCodes').then((m) => ({ default: m.IfCodes }))),
  },
  surveys: {
    hash: 'surveys', label: '问卷',
    component: lazy(() => import('./Surveys').then((m) => ({ default: m.Surveys }))),
  },
  'chat-test': {
    hash: 'chat-test', label: '对话测试',
    component: lazy(() => import('./ChatTest').then((m) => ({ default: m.ChatTest }))),
  },

  setup: {
    hash: 'setup', label: '一键向导',
    component: lazy(() => import('./Setup').then((m) => ({ default: m.Setup }))),
    description: '检查本地环境、API key、示例数据和常见启动问题；适合第一次启动或服务不对劲时用。',
  },
  audit: {
    hash: 'audit', label: '审计日志',
    component: lazy(() => import('./Audit').then((m) => ({ default: m.Audit }))),
  },
  users: {
    hash: 'users', label: '用户管理',
    component: lazy(() => import('./Users').then((m) => ({ default: m.UsersPanel }))),
  },
  candle: {
    hash: 'candle', label: '烛账',
    component: lazy(() => import('./Candle').then((m) => ({ default: m.Candle }))),
  },
  quota: {
    hash: 'quota', label: '配额',
    component: lazy(() => import('./Quota').then((m) => ({ default: m.Quota }))),
  },
  sessions: {
    hash: 'sessions', label: '会话',
    component: lazy(() => import('./Sessions').then((m) => ({ default: m.Sessions }))),
    description: '查看会话与消息记录。',
  },
  costs: {
    hash: 'costs', label: '成本统计',
    component: lazy(() => import('./Costs').then((m) => ({ default: m.Costs }))),
    description: '查看今日调用、tokens 和成本汇总。',
  },
  llm: {
    hash: 'llm', label: 'LLM 测试',
    component: lazy(() => import('./LlmTest').then((m) => ({ default: m.LlmTest }))),
    description: '测试 LLM provider 是否可用，定位 key、模型名或网络问题。',
  },
  'pay-test': {
    hash: 'pay-test', label: '支付测试',
    component: lazy(() => import('./PayTest').then((m) => ({ default: m.PayTest }))),
    description: '测试支付回调和本地支付流程（mock-only）。',
  },

  health: {
    hash: 'health', label: '健康检查',
    component: lazy(() => import('./Health').then((m) => ({ default: m.Health }))),
    description: '快速确认服务是否启动、当前运行模式、LLM/sidecar 是否 ready。',
  },
  diagnostics: {
    hash: 'diagnostics', label: '诊断',
    component: lazy(() => import('./Diagnostics').then((m) => ({ default: m.Diagnostics }))),
    description: '检查 .env、LLM key、ADMIN_TOKEN、prompt 资产、示例数据等常见问题。',
  },
  'db-tools': {
    hash: 'db-tools', label: 'DB 工具',
    description: '数据库迁移和查询 GUI，服务于 infra/db 的 SQL migration。',
  },
};

export function isLegacyRoute(hash: string): boolean {
  return ROUTES[hash]?.legacy === true;
}
