// 后台审计日志仓储 —— 只追加 + 查询。
// 缝约定见 docs/sprint/phase-a-repository-seam.md。
//
// 注：写入封装 `routes/admin/_audit.ts:audit()` 仍是「同步 fire-and-forget」门面
// （现有调用方都不 await），它内部 void 调本仓储的 append，保持零行为变化；
// 换 PG 时审计写仍可 fire-and-forget（与当前 debounce 落盘的非阻塞语义一致）。
import { randomUUID } from 'node:crypto';
import { store, type AdminAuditRow } from '../persistence';

export interface AppendAuditInput {
  action: string;
  actor?: string;
  target?: string;
  reason?: string;
  payload?: unknown;
}

export interface QueryAuditInput {
  action?: string;
  limit?: number;
  offset?: number;
}

export const adminAuditRepo = {
  /** 追加一条审计行（落盘）。返回落库后的完整行。 */
  async append(input: AppendAuditInput): Promise<AdminAuditRow> {
    const row: AdminAuditRow = {
      id: `aud_${randomUUID().slice(0, 8)}`,
      ts: new Date().toISOString(),
      action: input.action,
      actor: input.actor ?? 'admin',
      target: input.target,
      reason: input.reason,
      payload: input.payload,
    };
    store.state().adminAudit.push(row);
    store.save();
    return row;
  },

  /** 分页查询（最新在前）。action 命中精确值或其 `action.` 前缀子项。 */
  async query(input: QueryAuditInput = {}): Promise<{ rows: AdminAuditRow[]; total: number }> {
    const limit = Number.isFinite(input.limit)
      ? Math.min(Math.max(Math.trunc(input.limit as number), 1), 1000)
      : 200;
    const offset = Number.isFinite(input.offset) ? Math.max(Math.trunc(input.offset as number), 0) : 0;
    let rows = store.state().adminAudit;
    if (input.action) {
      const a = input.action;
      rows = rows.filter((r) => r.action === a || r.action.startsWith(`${a}.`));
    }
    const total = rows.length;
    rows = rows.slice(-(offset + limit)).reverse(); // 最新在前
    rows = rows.slice(offset, offset + limit);
    return { rows, total };
  },

  /** 当前审计行数（health/诊断用）。 */
  async count(): Promise<number> {
    return store.state().adminAudit.length;
  },
};
