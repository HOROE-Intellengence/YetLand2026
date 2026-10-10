import { isYelanManaged } from './yelan-managed-client';
import { kvGet, kvSet } from './kv-db';
import { inspectionText } from './phone-inspection-records';
const key = 'yelan-phone-diagnostics-v1';
export function recordPhoneDiagnostic(title: string, details: unknown) {
  if (!isYelanManaged || typeof window === 'undefined') return;
  let rows: unknown[] = [];
  try { rows = JSON.parse(kvGet(key) || '[]'); } catch { /* reset malformed evidence only */ }
  if (!Array.isArray(rows)) rows = [];
  kvSet(key, JSON.stringify([...rows.slice(-49), { id: crypto.randomUUID(), title,
    content: inspectionText(details).slice(0, 200000), createdAt: new Date().toISOString() }]));
}
export function phoneServiceError(error: unknown, fallback = '暂时无法完成，请稍后重试。') {
  if (!isYelanManaged) return error instanceof Error ? error.message : String(error);
  recordPhoneDiagnostic('服务调用失败', error instanceof Error ? error.message : error);
  return fallback;
}
