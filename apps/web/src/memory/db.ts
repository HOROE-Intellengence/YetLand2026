// 本地记忆库（Dexie / IndexedDB）—— 修订 #17 / #31 / #23
// 表：preferences, events, embedding_cache
// mode 字段：main | if（IF 线读时合并 main+if，写时只写当前 mode）
import Dexie, { type Table } from 'dexie';
import type { PreferenceCategory } from '@yelan/shared';

export interface PreferenceRow {
  id?: number;
  serverId?: string;
  characterId: string;
  text: string;
  category?: PreferenceCategory;
  embedding?: Float32Array;
  weight: number;
  lastUsedAt: number;
  mode: 'main' | 'if';
  dirty?: boolean;
  tombstone?: boolean;
  updatedAt?: string;
}

export interface EventRow {
  id?: number;
  serverId?: string;
  characterId: string;
  date: string;
  text: string;
  embedding?: Float32Array;
  emotion?: string;
  mode: 'main' | 'if';
  dirty?: boolean;
  tombstone?: boolean;
  updatedAt?: string;
}

export class YelanMemoryDB extends Dexie {
  preferences!: Table<PreferenceRow, number>;
  events!: Table<EventRow, number>;

  constructor() {
    super('yelan-memory');
    this.version(1).stores({
      preferences: '++id, characterId, mode, lastUsedAt',
      events: '++id, characterId, mode, date',
    });
    this.version(2).stores({
      preferences: '++id, serverId, characterId, mode, lastUsedAt, dirty, tombstone',
      events: '++id, serverId, characterId, mode, date, dirty, tombstone',
    });
  }
}

export const memoryDb = new YelanMemoryDB();
