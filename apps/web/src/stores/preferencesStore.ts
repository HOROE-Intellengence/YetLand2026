// FE-111 — UI 偏好 store
// 本地 Zustand store ← 启动时 GET /api/me/preferences → debounce PUT 同步回服务端
import { create } from 'zustand';
import { getPreferences, updatePreferences } from '../api/preferences';

export interface UIPreferences {
  theme: 'dark' | 'light';
  fontScale: number;
  locale: string;
  stageLayoutOverrides: Record<string, unknown>;
}

interface PreferencesState extends UIPreferences {
  loaded: boolean;
  fetch: () => Promise<void>;
  setTheme: (t: 'dark' | 'light') => void;
  setFontScale: (s: number) => void;
  setLocale: (l: string) => void;
  setStageLayoutOverrides: (o: Record<string, unknown>) => void;
}

let _debounceTimer: ReturnType<typeof setTimeout> | null = null;
const DEBOUNCE_MS = 200;

function pushToServer(prefs: Partial<UIPreferences>): void {
  if (_debounceTimer) clearTimeout(_debounceTimer);
  _debounceTimer = setTimeout(async () => {
    try {
      await updatePreferences(prefs);
    } catch {
      // 静默降级 — 下次 set 会重试
    }
  }, DEBOUNCE_MS);
}

export const usePreferencesStore = create<PreferencesState>((set, _get) => ({
  theme: 'dark',
  fontScale: 1.0,
  locale: 'zh-CN',
  stageLayoutOverrides: {},
  loaded: false,

  fetch: async () => {
    try {
      const data = await getPreferences();
      set({
        theme: data.theme,
        fontScale: data.fontScale,
        locale: data.locale,
        stageLayoutOverrides: data.stageLayoutOverrides,
        loaded: true,
      });
    } catch {
      set({ loaded: true }); // 服务端不可达时用默认值
    }
  },

  setTheme: (theme) => {
    set({ theme });
    pushToServer({ theme });
  },

  setFontScale: (fontScale) => {
    set({ fontScale });
    pushToServer({ fontScale });
  },

  setLocale: (locale) => {
    set({ locale });
    pushToServer({ locale });
  },

  setStageLayoutOverrides: (stageLayoutOverrides) => {
    set({ stageLayoutOverrides });
    pushToServer({ stageLayoutOverrides });
  },
}));
