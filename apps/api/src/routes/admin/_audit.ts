import { adminAuditRepo } from '../../store/repositories';

/**
 * 同步 fire-and-forget 审计门面 —— 所有 admin 写动作调它，不 await。
 * 底层走 adminAuditRepo.append（异步签名，为换 PG 预留），与原 debounce 落盘的
 * 非阻塞语义一致；写失败不致命，故 void 调用即可。
 */
export function audit(action: string, target?: string, reason?: string, payload?: unknown): void {
  void adminAuditRepo.append({ action, target, reason, payload });
}
