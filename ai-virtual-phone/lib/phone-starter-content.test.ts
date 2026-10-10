import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKPHONE_APP_SPECS } from './checkphone-config';
import { createStarterManifest, createStarterSnapshot } from './checkphone-defaults';
import { createStarterDiaryEntries, createStarterDwelling, createStarterItemHtml, createStarterXiaohongshuNotes } from './phone-starter-content';
import { createStarterMusicAudio, createStarterMusicTrack } from './music-starter';

const { values, persisted } = vi.hoisted(() => ({ values: new Map<string, string>(), persisted: new Map<string, unknown>() }));
vi.mock('./kv-db', () => ({
  kvGet: (key: string) => values.get(key) ?? null,
  kvSet: (key: string, value: string) => values.set(key, value),
  kvRemove: (key: string) => values.delete(key), registerKvMigration: () => {}, registerDynamicPrefix: () => {},
}));
vi.mock('./settings-storage', () => ({ resolveUserIdentity: () => null }));
vi.mock('./shopping-engine', () => ({ DEFAULT_SHOPPING_REFRESH_PROMPT: 'refresh', DEFAULT_SHOPPING_SEARCH_PROMPT: 'search', SHOPPING_RECOMMENDATION_CATEGORIES: ['digital', 'home', 'style', 'beauty', 'food', 'hobby'].map(id => ({ id, title: id, subtitle: '' })) }));
vi.mock('dexie', () => ({ default: class {
  version() { return { stores: () => {
    Object.assign(this, {
      manifests: { get: async (key: string) => persisted.get(`manifest:${key}`), put: async (row: { characterId: string }) => persisted.set(`manifest:${row.characterId}`, row), delete: async (key: string) => persisted.delete(`manifest:${key}`) },
      snapshots: { get: async (key: string) => persisted.get(`snapshot:${key}`), put: async (row: { id: string }) => persisted.set(`snapshot:${row.id}`, row), delete: async (key: string) => persisted.delete(`snapshot:${key}`) },
    });
    return this;
  } }; }
} }));

import { loadShoppingState, saveShoppingState } from './shopping-storage';
import { loadXiaohongshuState, saveXiaohongshuState } from './xiaohongshu-storage';
import { clearPhoneSnapshot, loadPhoneManifest, loadPhoneSnapshot, readPhoneSnapshotCache, savePhoneSnapshot } from './checkphone-storage';

beforeEach(() => {
  values.clear(); persisted.clear();
  vi.stubGlobal('window', { dispatchEvent: () => {} });
  vi.stubGlobal('CustomEvent', class { constructor(public type: string) {} });
});

describe('phone starter content', () => {
  it('supplies a real, non-silent WAV matching the initial track duration', async () => {
    const track = createStarterMusicTrack();
    const audio = createStarterMusicAudio();
    const data = await audio.arrayBuffer();
    const view = new DataView(data);
    expect(new TextDecoder().decode(data.slice(0, 4))).toBe('RIFF');
    expect((data.byteLength - 44) / view.getUint32(28, true)).toBe(track.duration);
    expect(new Int16Array(data.slice(44)).some(sample => sample !== 0)).toBe(true);
  });
  it('provides valid browsable content for all 23 checkphone apps without shared mutations', () => {
    for (const appId of Object.keys(CHECKPHONE_APP_SPECS) as (keyof typeof CHECKPHONE_APP_SPECS)[]) {
      const first = createStarterSnapshot('role-a', appId);
      const second = createStarterSnapshot('role-b', appId);
      expect(first.summary).toContain('初始示例');
      expect(first.payload).not.toBe(second.payload);
      const arrays = Object.values(first.payload as Record<string, unknown>).filter(Array.isArray);
      expect(arrays.some(array => array.length > 0)).toBe(true);
    }
  });
  it('keeps manifest counts, app associations and dock consistent', () => {
    const manifest = createStarterManifest('role-a');
    expect(manifest.topAppIds).toHaveLength(12);
    expect(manifest.dockAppIds).toHaveLength(4);
    expect(new Set(manifest.allAppIds).size).toBe(16);
  });
  it('uses defaults only when no generated snapshot exists and does not record example memory', async () => {
    await clearPhoneSnapshot('fresh', 'notes');
    expect((await loadPhoneSnapshot('fresh', 'notes'))?.summary).toContain('初始示例');
    expect(readPhoneSnapshotCache('fresh', 'notes')).toBeNull();
    expect(persisted.size).toBe(0);
    expect(values.size).toBe(0);
    const actual = { ...createStarterSnapshot('fresh', 'notes'), summary: '真实生成', payload: { notes: [{ id: 'real' }] } };
    await savePhoneSnapshot(actual);
    expect(await loadPhoneSnapshot('fresh', 'notes')).toEqual(actual);
    expect((await loadPhoneSnapshot('different-role', 'notes'))?.summary).toContain('初始示例');
  });
  it('does not overwrite an existing manifest', async () => {
    const manifest = { ...createStarterManifest('existing'), optionalAppIds: [], allAppIds: ['notes'] };
    persisted.set('manifest:existing', manifest);
    expect(await loadPhoneManifest('existing')).toEqual(manifest);
  });
  it('shows starter shopping products while preserving saved items, orders and custom settings', () => {
    const state = loadShoppingState();
    expect(state.catalog.recommendations.length).toBeGreaterThan(0);
    expect(state.catalog.categories).toHaveLength(6);
    expect(state.catalog.categories.every(category => category.items.length > 0)).toBe(true);
    state.savedItems = [state.catalog.recommendations[0]];
    state.settings.searchPrompt = 'custom';
    state.catalog = { categories: [], recommendations: [] };
    saveShoppingState(state);
    const reloaded = loadShoppingState();
    expect(reloaded.catalog.recommendations.length).toBeGreaterThan(0);
    expect(reloaded.savedItems).toEqual(state.savedItems);
    expect(reloaded.settings.searchPrompt).toBe('custom');
  });
  it('keeps actual shopping recommendations intact', () => {
    const state = loadShoppingState();
    state.catalog.categories = [];
    state.catalog.recommendations = [{ ...state.catalog.recommendations[0], id: 'real-product', title: '用户商品' }];
    saveShoppingState(state);
    expect(loadShoppingState().catalog.recommendations.map(product => product.id)).toEqual(['real-product']);
  });
  it('offers posts and videos initially, preserving real posts and profile after save', () => {
    const state = loadXiaohongshuState();
    expect(state.notes.some(note => note.type === 'video')).toBe(true);
    expect(state.notes.some(note => note.type === 'post')).toBe(true);
    state.notes = [{ ...state.notes[0], id: 'real-note', title: '我的笔记' }];
    state.profile.nickname = '自定义昵称';
    saveXiaohongshuState(state);
    const reloaded = loadXiaohongshuState();
    expect(reloaded.notes.map(note => note.id)).toEqual(['real-note']);
    expect(reloaded.profile.nickname).toBe('自定义昵称');
  });
  it('provides a dwelling with locally browsable items and explicit example attribution', () => {
    const layout = createStarterDwelling();
    const html = createStarterItemHtml(layout);
    expect(Object.keys(html)).toHaveLength(4);
    for (const body of Object.values(html)) expect(body).toContain('初始示例');
    expect(layout.rooms[0].imageAssetId).toBeUndefined();
  });
  it('provides character-associated example diaries without writing to storage', () => {
    const characters = [{ id: 'a', name: '江白' }, { id: 'b', name: '霍金' }] as Parameters<typeof createStarterDiaryEntries>[0];
    const entries = createStarterDiaryEntries(characters);
    expect(entries.map(entry => entry.characterId)).toEqual(['a', 'b']);
    expect(entries.every(entry => entry.tags.includes('初始示例'))).toBe(true);
    expect(values.size).toBe(0);
    expect(createStarterXiaohongshuNotes()).toHaveLength(10);
  });
});
