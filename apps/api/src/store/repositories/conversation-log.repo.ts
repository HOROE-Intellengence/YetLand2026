// 会话/埋点日志仓储 —— 只追加、有界保留。
//
// 仓储缝约定（Phase A，详见 docs/sprint/phase-a-repository-seam.md）：
//  1. 方法签名一律 async（返回 Promise），即便 JSON 实现是同步的 ——
//     这样将来换 Postgres 时调用方不用再改第二次。
//  2. 落盘由仓储负责，调用方不再直接 store.save()。
//  3. 调用方不碰 store.state().conversationLogs —— 全部经本仓储。
import { randomUUID } from 'node:crypto';
import { store, pushBounded, LOG_RETENTION, type ConversationLogRow } from '../persistence';

export interface AppendConversationLogInput {
  userId: string;
  sessionId: string;
  payload: unknown;
  /** id 前缀，保留改造前的语义区分（对话日志 'log' / 埋点 'tlm'）。默认 'log'。 */
  idPrefix?: string;
}

export const conversationLogRepo = {
  /** 追加一条日志（有界保留 + 落盘）。返回落库后的完整行。 */
  async append(input: AppendConversationLogInput): Promise<ConversationLogRow> {
    const row: ConversationLogRow = {
      id: `${input.idPrefix ?? 'log'}_${randomUUID().slice(0, 8)}`,
      userId: input.userId,
      sessionId: input.sessionId,
      payload: input.payload,
      createdAt: new Date().toISOString(),
    };
    pushBounded(store.state().conversationLogs, row, LOG_RETENTION.conversationLogs);
    store.save();
    return row;
  },

  /** 读取某用户最近 N 条（新→旧）。admin / 诊断预留。 */
  async listByUser(userId: string, limit = 100): Promise<ConversationLogRow[]> {
    return store
      .state()
      .conversationLogs.filter((r) => r.userId === userId)
      .slice(-limit)
      .reverse();
  },
};
