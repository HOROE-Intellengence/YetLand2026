import { describe, expect, it, vi } from 'vitest';
vi.mock('./yelan-managed-client', () => ({ isYelanManaged: true }));
vi.mock('./kv-db', () => ({ kvGet: () => null, kvSet: vi.fn(), registerKvMigration: vi.fn() }));
import { createDefaultCoCreateSettings, saveCoCreateLibrary } from './cocreate-storage';
describe('managed co-creation retains user authoring choices', () => {
  it('takes over the summary interval while retaining acceptance, actions, streaming and chapter choices', () => {
    const saved = saveCoCreateLibrary({ activeSessionId: '', sessions: [], settings: { ...createDefaultCoCreateSettings(), memorySummaryInterval: 99, autoAccept: false, streamingEnabled: true, recentFullTextChapters: 7, disabledToolNames: ['delete_chapter'] } });
    expect(saved.settings).toEqual({ memorySummaryInterval: 20, autoAccept: false, streamingEnabled: true, recentFullTextChapters: 7, disabledToolNames: ['delete_chapter'] });
  });
});
