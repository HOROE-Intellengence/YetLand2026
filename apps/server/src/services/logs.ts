import type { Env } from '../types/bindings';
import type { ConversationLogRow } from '@yelan/shared';

export async function uploadConversation(env: Env, rows: ConversationLogRow[]): Promise<void> {
  if (!env.DB || rows.length === 0) return;

  // TODO: PII 脱敏（手机号、姓名）后再写入
  const stmt = env.DB.prepare(
    `INSERT INTO conversation_logs (user_id, session_id, character_id, mode, stage, role, content, token_count)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  );

  const batch = rows.map((r) =>
    stmt.bind(r.userId, r.sessionId, r.characterId, r.mode, r.stage, r.role, r.content, r.tokenCount ?? 0),
  );

  await env.DB.batch(batch);
}
