// Repository 层 — 把 SQL 与业务逻辑隔开
// 每个表一组函数；事务在 services 层组合
import type { Db } from './client';

// ─── users ──────────────────────────────────────────────────
export const usersRepo = (_db: Db) => ({
  async getById(_id: string) { return null; },
  async getByPhone(_phone: string) { return null; },
  async upsertByPhone(_phone: string) { return { id: 'TODO', isNew: true }; },
});

// ─── subscriptions ──────────────────────────────────────────
export const subscriptionsRepo = (_db: Db) => ({
  async getActive(_userId: string) { return null; },
  async upsertFromGateway(_payload: unknown) { /* TODO 幂等 */ },
});

// ─── candle ─────────────────────────────────────────────────
export const candleRepo = (_db: Db) => ({
  async getBalance(_userId: string) { return 0; },
  async insertLedger(_row: unknown) { /* TODO INSERT ON CONFLICT DO NOTHING */ },
  async listLedger(_userId: string, _opts?: { limit?: number; before?: string }) { return []; },
});

// ─── quota ──────────────────────────────────────────────────
export const quotaRepo = (_db: Db) => ({
  async getToday(_userId: string) { return null; },
  async incrementUsed(_userId: string, _kind: 'free' | 'bonus') { return 0; },
});

// ─── characters ─────────────────────────────────────────────
export const charactersRepo = (_db: Db) => ({
  async listActive() { return []; },
  async getById(_id: string) { return null; },
  async listUnlocks(_userId: string) { return []; },
  async insertUnlock(_userId: string, _characterId: string, _source: string) { /* TODO */ },
});

// ─── sessions / messages ────────────────────────────────────
export const sessionsRepo = (_db: Db) => ({
  async getRecent(_userId: string) { return null; },
  async create(_userId: string, _characterId: string, _mode: 'main' | 'if') { return { id: 'TODO' }; },
});

// ─── achievements ───────────────────────────────────────────
export const achievementsRepo = (_db: Db) => ({
  async listAll() { return []; },
  async listForUser(_userId: string) { return []; },
  async insertUnlock(_userId: string, _slug: string, _ctx: unknown) { /* TODO 幂等 */ },
});

// ─── surveys ────────────────────────────────────────────────
export const surveysRepo = (_db: Db) => ({
  async getActive() { return null; },
  async insertCompletion(_userId: string, _surveyId: string, _ledgerId: string) { /* 幂等 */ },
});

// ─── if codes ───────────────────────────────────────────────
export const ifCodesRepo = (_db: Db) => ({
  async findByHash(_hash: string) { return null; },
  async incrementRedeemed(_id: string) { /* TODO */ },
});

// ─── conversation logs ──────────────────────────────────────
export const logsRepo = (_db: Db) => ({
  async insertBatch(_rows: unknown[]) { /* TODO */ },
});

// ─── user flags ─────────────────────────────────────────────
export const userFlagsRepo = (_db: Db) => ({
  async setIfUnlocked(_userId: string, _source: string) { /* TODO */ },
});
