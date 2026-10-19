import { beforeEach, describe, expect, it, vi } from 'vitest';
const fixtures = vi.hoisted(() => ({
  values: new Map<string, string>(),
  profile: null as any,
  writes: 0,
  assets: [] as any[],
}));
vi.mock('./kv-db', () => ({
  kvGet: (k: string) => fixtures.values.get(k) || null,
  kvSetAsync: async (k: string, v: string) => {
    fixtures.values.set(k, v);
  },
}));
vi.mock('./theme-storage', () => ({
  readThemeProfile: () => structuredClone(fixtures.profile),
  writeThemeProfile: (p: any) => {
    fixtures.profile = structuredClone(p);
    fixtures.writes++;
    return fixtures.profile;
  },
  writeThemeAssetRecords: async (a: any[]) => {
    fixtures.assets.push(...a);
  },
}));
import { applyCommunityTheme, restoreCommunityTheme } from './community-theme';
import { DEFAULT_THEME_PROFILE } from './theme-types';
import type { CommunityThemeState } from '../../packages/shared/src/contracts/community-resources';
const state: CommunityThemeState = {
  revision: 'first',
  installationId: 'asset-one',
  theme: {
    schema: 'yelan-phone-theme',
    schemaVersion: 1,
    name: '苔绿',
    fontFamily: 'system',
    cssOverrides: { '--c-header-bg': '#f7f5ef', '--c-text': '#26332c' },
  },
};
describe('community theme consumer', () => {
  beforeEach(() => {
    fixtures.values.clear();
    fixtures.profile = structuredClone({
      ...DEFAULT_THEME_PROFILE,
      name: '用户原主题',
      cssOverrides: { '--c-header-bg': '#123456' },
      iconSkins: { settings: 'my-icon' },
    });
    fixtures.writes = 0;
    fixtures.assets = [];
  });
  it('applies once per account revision and retains subsequent local edits', async () => {
    await applyCommunityTheme(state);
    expect(fixtures.profile.cssOverrides['--c-header-bg']).toBe('#f7f5ef');
    fixtures.profile.cssOverrides['--c-text'] = '#777777';
    await applyCommunityTheme(state);
    expect(fixtures.profile.cssOverrides['--c-text']).toBe('#777777');
    expect(fixtures.writes).toBe(1);
  });
  it('restores prior appearance without overwriting colors or icons the user edited later', async () => {
    await applyCommunityTheme(state);
    fixtures.profile.cssOverrides['--c-text'] = '#777777';
    await applyCommunityTheme({ revision: 'restore', installationId: null, theme: null });
    expect(fixtures.profile.cssOverrides).toEqual({
      '--c-header-bg': '#123456',
      '--c-text': '#777777',
    });
    expect(fixtures.profile.name).toBe('用户原主题');
    expect(fixtures.profile.iconSkins.settings).toBe('my-icon');
  });
  it('switches versions while retaining the original restoration point', async () => {
    await applyCommunityTheme(state);
    await applyCommunityTheme({
      ...state,
      revision: 'second',
      theme: { ...state.theme!, name: '新版', cssOverrides: { '--c-header-bg': '#eeeeee' } },
    });
    expect(fixtures.profile.cssOverrides).toEqual({ '--c-header-bg': '#eeeeee' });
    await applyCommunityTheme({ revision: 'restore', installationId: null, theme: null });
    expect(fixtures.profile.cssOverrides).toEqual({ '--c-header-bg': '#123456' });
  });
  it('leaves an existing production bootstrap without a community theme unchanged', async () => {
    await applyCommunityTheme(undefined);
    expect(fixtures.writes).toBe(0);
  });
  it('stores wallpaper in the existing asset store and restores the previous wallpaper', async () => {
    fixtures.profile.wallpaperAssetId = 'user-wallpaper';
    await applyCommunityTheme({
      ...state,
      theme: {
        ...state.theme!,
        wallpaper: {
          dataUrl:
            'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6Zz0AAAAASUVORK5CYII=',
          blur: 2,
          opacity: 0.8,
          scale: 100,
          x: 50,
          y: 50,
        },
      },
    });
    expect(fixtures.assets[0]).toMatchObject({
      id: 'yelan-community:asset-one:wallpaper',
      type: 'wallpaper',
      mimeType: 'image/png',
    });
    expect(fixtures.profile.wallpaperAssetId).toBe('yelan-community:asset-one:wallpaper');
    await applyCommunityTheme({ revision: 'restore', installationId: null, theme: null });
    expect(fixtures.profile.wallpaperAssetId).toBe('user-wallpaper');
  });
});
