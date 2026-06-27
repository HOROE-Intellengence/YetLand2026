// 结构化错误日志 — JSONL 格式输出到 apps/api/.local/logs/error.log
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LOG_DIR = resolve(here, '..', '..', '.local', 'logs');
const LOG_FILE = resolve(LOG_DIR, 'error.log');

interface ErrorLogEntry {
  ts: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  code?: string;
  message: string;
  userId?: string;
  stack?: string;
}

function ensureDir(): void {
  if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });
}

export function logError(entry: ErrorLogEntry): void {
  if (process.env.NODE_ENV === 'test') return;
  try {
    ensureDir();
    appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // 日志写失败不能影响业务
    console.warn('[error-logger] failed to write log');
  }
}

/** Hono onError 钩子 */
export function errorLogHook(err: Error, c: { req: { method: string; path: string }; get: (k: string) => unknown }): void {
  const requestId = (c.get('requestId') as string) ?? 'unknown';
  const userId = (c.get('userId') as string) ?? undefined;
  logError({
    ts: new Date().toISOString(),
    requestId,
    method: c.req.method,
    path: c.req.path,
    status: 500,
    code: 'INTERNAL_ERROR',
    message: err.message,
    userId,
    stack: err.stack,
  });
}
