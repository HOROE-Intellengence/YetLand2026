// 用户成就仓储 —— 按用户读已解锁列表 + 幂等解锁。
// 缝约定见 docs/sprint/phase-a-repository-seam.md。
import { store } from '../persistence';

export interface AchievementUnlockRow {
  achievementId: string;
  unlockedAt: string;
  sessionId?: string;
}

export const achievementRepo = {
  /** 某用户已解锁成就（原序）。 */
  async listByUser(userId: string): Promise<AchievementUnlockRow[]> {
    return store.state().userAchievements[userId] ?? [];
  },

  /** 解锁一个成就（幂等：已解锁则跳过）。预留写入口——当前无 production 写入方，测试直接 seed。 */
  async unlock(userId: string, achievementId: string, sessionId?: string): Promise<void> {
    const s = store.state();
    s.userAchievements[userId] ??= [];
    if (s.userAchievements[userId].some((r) => r.achievementId === achievementId)) return;
    s.userAchievements[userId].push({ achievementId, unlockedAt: new Date().toISOString(), sessionId });
    store.save();
  },
};
