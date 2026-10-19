import {
  CommunityThemeSchema,
  type CommunityThemeState,
} from '../../packages/shared/src/contracts/community-resources';
import { kvGet, kvSetAsync } from './kv-db';
import { readThemeProfile, writeThemeAssetRecords, writeThemeProfile } from './theme-storage';
import { DEFAULT_FONT_FAMILY, type ThemeProfile } from './theme-types';

const KEY = 'yelan-community-theme-v1';
type Saved = { revision: string; before: ThemeProfile | null; applied: ThemeProfile | null };
const fields = [
  'name',
  'fontFamily',
  'wallpaperAssetId',
  'wallpaperBlur',
  'wallpaperOpacity',
  'wallpaperScale',
  'wallpaperX',
  'wallpaperY',
] as const;

/** Undo only fields we changed and which the user has not subsequently edited. */
export function restoreCommunityTheme(
  current: ThemeProfile,
  before: ThemeProfile,
  applied: ThemeProfile,
): ThemeProfile {
  const restored = { ...current, cssOverrides: { ...current.cssOverrides } };
  for (const field of fields)
    if (current[field] === applied[field]) Object.assign(restored, { [field]: before[field] });
  for (const key of new Set([
    ...Object.keys(before.cssOverrides),
    ...Object.keys(applied.cssOverrides),
  ])) {
    if (current.cssOverrides[key] !== applied.cssOverrides[key]) continue;
    if (before.cssOverrides[key] === undefined) delete restored.cssOverrides[key];
    else restored.cssOverrides[key] = before.cssOverrides[key];
  }
  return restored;
}

export async function applyCommunityTheme(state?: CommunityThemeState) {
  if (!state) return; // Existing production bootstrap has no community theme yet.
  const raw = kvGet(KEY);
  let saved: Saved | undefined;
  try {
    saved = raw ? JSON.parse(raw) : undefined;
  } catch {
    /* Ignore an invalid local receipt. */
  }
  if (saved?.revision === state.revision) return;
  const current = readThemeProfile();
  const base =
    saved?.before && saved.applied
      ? restoreCommunityTheme(current, saved.before, saved.applied)
      : current;
  if (!state.theme || !state.installationId) {
    if (saved?.applied) writeThemeProfile(base);
    await kvSetAsync(
      KEY,
      JSON.stringify({ revision: state.revision, before: null, applied: null } satisfies Saved),
    );
    return;
  }
  const theme = CommunityThemeSchema.parse(state.theme);
  const next: ThemeProfile = {
    ...base,
    name: theme.name,
    cssOverrides: { ...base.cssOverrides, ...theme.cssOverrides },
    fontFamily: {
      system: DEFAULT_FONT_FAMILY,
      serif: '"Noto Serif SC", "Songti SC", serif',
      monospace: '"SFMono-Regular", Consolas, monospace',
    }[theme.fontFamily],
  };
  if (theme.wallpaper) {
    const id = `yelan-community:${state.installationId}:wallpaper`;
    await writeThemeAssetRecords([
      {
        id,
        type: 'wallpaper',
        mimeType: theme.wallpaper.dataUrl.slice(5, theme.wallpaper.dataUrl.indexOf(';')),
        dataUrl: theme.wallpaper.dataUrl,
        updatedAt: new Date().toISOString(),
      },
    ]);
    Object.assign(next, {
      wallpaperAssetId: id,
      wallpaperBlur: theme.wallpaper.blur,
      wallpaperOpacity: theme.wallpaper.opacity,
      wallpaperScale: theme.wallpaper.scale,
      wallpaperX: theme.wallpaper.x,
      wallpaperY: theme.wallpaper.y,
      wallpaperLibrary: [...new Set([id, ...base.wallpaperLibrary])],
    });
  }
  const applied = writeThemeProfile(next);
  await kvSetAsync(
    KEY,
    JSON.stringify({ revision: state.revision, before: base, applied } satisfies Saved),
  );
}
