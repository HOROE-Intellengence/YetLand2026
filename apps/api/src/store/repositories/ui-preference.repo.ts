// 用户 UI 偏好仓储（BE-103）—— 单行 upsert，缺省不落库。
// 缝约定见 docs/sprint/phase-a-repository-seam.md。
import { store, type UserUIPrefRow } from '../persistence';

export type UiPreferencePatch = Partial<
  Pick<UserUIPrefRow, 'theme' | 'fontScale' | 'locale' | 'stageLayoutOverrides'>
>;

function defaultPrefs(userId: string): UserUIPrefRow {
  return {
    userId,
    theme: 'dark',
    fontScale: 1.0,
    locale: 'zh-CN',
    stageLayoutOverrides: {},
    updatedAt: new Date().toISOString(),
  };
}

export const uiPreferenceRepo = {
  /** 读当前用户偏好；无记录返回缺省（不落库，与原 GET 行为一致）。 */
  async get(userId: string): Promise<UserUIPrefRow> {
    return store.state().userUIPreferences[userId] ?? defaultPrefs(userId);
  },

  /** 全量 upsert：缺字段沿用上一条（或缺省），更新 updatedAt 后落库。 */
  async upsert(userId: string, patch: UiPreferencePatch): Promise<UserUIPrefRow> {
    const s = store.state();
    const prev = s.userUIPreferences[userId] ?? defaultPrefs(userId);
    const row: UserUIPrefRow = {
      userId,
      theme: patch.theme ?? prev.theme,
      fontScale: patch.fontScale ?? prev.fontScale,
      locale: patch.locale ?? prev.locale,
      stageLayoutOverrides: patch.stageLayoutOverrides ?? prev.stageLayoutOverrides,
      updatedAt: new Date().toISOString(),
    };
    s.userUIPreferences[userId] = row;
    store.save();
    return row;
  },
};
