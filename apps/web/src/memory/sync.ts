// FE-110 — Dexie ↔ 服务端双向同步
// 本地 Dexie 是缓存层；服务端（/api/me/memories）是真理源
// 同步时机：启动时 + 每 30s 定时 + 关键事件（发完一轮对话）
import { memoryDb } from './db';
import { ApiError } from '../api/client';
import { deleteMemory, listMemories, upsertMemories } from '../api/memories';
import type { MeMemoriesListResponse, MeMemoriesUpsert } from '@yelan/shared';

const SYNC_INTERVAL_MS = 30_000;
const SINCE_KEY = 'yelan.memory.since';

function getSinceToken(): string | null {
  try { return localStorage.getItem(SINCE_KEY); } catch { return null; }
}

function setSinceToken(token: string): void {
  try { localStorage.setItem(SINCE_KEY, token); } catch { /* noop */ }
}

// ── 上行：本地 dirty 行 → POST 服务端 ──

export async function syncUp(): Promise<void> {
  const allPrefs = await memoryDb.preferences.toArray();
  const allEvts = await memoryDb.events.toArray();

  const dirtyPrefs = allPrefs.filter((p) => !p.tombstone && (p.dirty || !p.serverId));
  const dirtyEvts = allEvts.filter((e) => !e.tombstone && (e.dirty || !e.serverId));
  const deletedPrefs = allPrefs.filter((p) => p.tombstone && p.serverId);
  const deletedEvts = allEvts.filter((e) => e.tombstone && e.serverId);

  // ── 上行删除：tombstone 行 → DELETE /api/me/memories/:id ──
  for (const p of deletedPrefs) {
    try {
      await deleteMemory(p.serverId!);
      await memoryDb.preferences.delete(p.id!);
    } catch (e) {
      console.warn('[sync] delete preference failed:', (e as Error).message);
    }
  }
  for (const e of deletedEvts) {
    try {
      await deleteMemory(e.serverId!);
      await memoryDb.events.delete(e.id!);
    } catch (err) {
      console.warn('[sync] delete event failed:', (err as Error).message);
    }
  }

  // ── 上行 upsert：dirty 行 → POST ──
  if (dirtyPrefs.length === 0 && dirtyEvts.length === 0) return;

  const payload: MeMemoriesUpsert = {};

  if (dirtyPrefs.length > 0) {
    payload.preferences = dirtyPrefs.map((p) => ({
      clientId: p.id, // 本地 Dexie id，用于回填匹配
      id: p.serverId,
      characterId: p.characterId,
      mode: p.mode,
      text: p.text.slice(0, 2000),
      category: p.category ?? 'other',
      embedding: p.embedding ? Array.from(p.embedding).slice(0, 4096) : undefined,
      weight: p.weight,
    }));
  }

  if (dirtyEvts.length > 0) {
    payload.events = dirtyEvts.map((e) => ({
      clientId: e.id,
      id: e.serverId,
      characterId: e.characterId,
      mode: e.mode,
      date: e.date.slice(0, 32),
      text: e.text.slice(0, 2000),
      embedding: e.embedding ? Array.from(e.embedding).slice(0, 4096) : undefined,
      emotion: e.emotion?.slice(0, 64),
    }));
  }

  try {
    const result = await upsertMemories(payload);

    // 按 clientId 回填 serverId（不再依赖数组下标）
    for (const remote of result.preferences) {
      if (remote.clientId === undefined) continue;
      await memoryDb.preferences.update(remote.clientId, {
        serverId: remote.id,
        dirty: false,
        category: remote.category,
        updatedAt: remote.updatedAt,
        lastUsedAt: new Date(remote.lastUsedAt).getTime(),
      });
    }
    for (const remote of result.events) {
      if (remote.clientId === undefined) continue;
      await memoryDb.events.update(remote.clientId, {
        serverId: remote.id,
        dirty: false,
        updatedAt: remote.updatedAt,
      });
    }
  } catch (e) {
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) {
      // 4xx 永久失败 — 标记为 syncFailed 避免无限重试
      console.warn('[sync] upsert rejected by server:', e.status, e.code, e.message);
      for (const p of dirtyPrefs) {
        if (p.id !== undefined) await memoryDb.preferences.update(p.id, { dirty: false });
      }
      for (const ev of dirtyEvts) {
        if (ev.id !== undefined) await memoryDb.events.update(ev.id, { dirty: false });
      }
    } else {
      // 网络错误 / 5xx — 保留 dirty，下次重试
      console.warn('[sync] upsert failed (will retry):', (e as Error).message);
    }
  }
}

// ── 下行：拉取服务端增量 → merge 进本地 Dexie ──

export async function syncDown(): Promise<void> {
  const since = getSinceToken() ?? undefined;

  let data: MeMemoriesListResponse;
  try {
    data = await listMemories({ since });
  } catch {
    return; // 服务端不可达时静默降级
  }

  for (const p of data.preferences) {
    const existing = await memoryDb.preferences.where('serverId').equals(p.id).first();
    if (p.tombstone) {
      if (existing?.id !== undefined) await memoryDb.preferences.delete(existing.id);
      continue;
    }
    if (!existing) {
      await memoryDb.preferences.put({
        serverId: p.id,
        characterId: p.characterId,
        text: p.text.slice(0, 2000),
        category: p.category,
        embedding: p.embedding ? new Float32Array(p.embedding.slice(0, 4096)) : undefined,
        weight: p.weight,
        lastUsedAt: new Date(p.lastUsedAt).getTime(),
        mode: p.mode,
        dirty: false,
        tombstone: false,
        updatedAt: p.updatedAt,
      });
    } else if (!existing.dirty && existing.id !== undefined) {
      await memoryDb.preferences.update(existing.id, {
        text: p.text.slice(0, 2000),
        category: p.category,
        embedding: p.embedding ? new Float32Array(p.embedding.slice(0, 4096)) : undefined,
        weight: p.weight,
        lastUsedAt: new Date(p.lastUsedAt).getTime(),
        mode: p.mode,
        updatedAt: p.updatedAt,
      });
    }
  }

  for (const e of data.events) {
    const existing = await memoryDb.events.where('serverId').equals(e.id).first();
    if (e.tombstone) {
      if (existing?.id !== undefined) await memoryDb.events.delete(existing.id);
      continue;
    }
    if (!existing) {
      await memoryDb.events.put({
        serverId: e.id,
        characterId: e.characterId,
        date: e.date.slice(0, 32),
        text: e.text.slice(0, 2000),
        embedding: e.embedding ? new Float32Array(e.embedding.slice(0, 4096)) : undefined,
        emotion: e.emotion?.slice(0, 64),
        mode: e.mode,
        dirty: false,
        tombstone: false,
        updatedAt: e.updatedAt,
      });
    } else if (!existing.dirty && existing.id !== undefined) {
      await memoryDb.events.update(existing.id, {
        date: e.date.slice(0, 32),
        text: e.text.slice(0, 2000),
        embedding: e.embedding ? new Float32Array(e.embedding.slice(0, 4096)) : undefined,
        emotion: e.emotion?.slice(0, 64),
        mode: e.mode,
        updatedAt: e.updatedAt,
      });
    }
  }

  setSinceToken(new Date().toISOString());
}

// ── 全量同步（启动时调用） ──

export async function fullSync(): Promise<void> {
  await syncDown();
  await syncUp();
}

// ── 定时器 ──

let _timer: ReturnType<typeof setInterval> | null = null;

export function startSyncTimer(): void {
  if (_timer) return;
  _timer = setInterval(() => {
    syncUp().then(() => syncDown());
  }, SYNC_INTERVAL_MS);
}

export function stopSyncTimer(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

// ── 关键事件触发 ──

export function onRoundComplete(): void {
  syncUp();
}
