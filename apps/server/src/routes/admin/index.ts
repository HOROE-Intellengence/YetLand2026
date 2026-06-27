// 远程运营后台 — admin 子路由已迁移到 apps/api，边缘层仅保留鉴权骨架
// Phase 5 上线时按需接回独立 admin 鉴权端点
import { Hono } from 'hono';
import type { Env } from '../../types/bindings';
import { requireAdmin } from '../../middleware/admin-auth';

export const adminRoute = new Hono<{ Bindings: Env }>();

adminRoute.use('*', requireAdmin());
// 所有 admin 子路由由 fallback 代理到 Node 后端
