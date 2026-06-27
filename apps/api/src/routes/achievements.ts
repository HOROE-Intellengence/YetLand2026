import { Hono } from 'hono';
import {
  AchievementsListResponseSchema,
  UserAchievementsResponseSchema,
  type UserAchievement,
} from '@yelan/shared';
import { mockAchievements } from '../fixtures/achievements';
import { softAuth } from '../middleware/auth';
import { achievementRepo } from '../store/repositories';

export const mockAchievementsRoute = new Hono();

// 公开：成就字典
mockAchievementsRoute.get('/', (c) => c.json(AchievementsListResponseSchema.parse(mockAchievements)));

// 当前用户已解锁
mockAchievementsRoute.use('/me', softAuth());
mockAchievementsRoute.get('/me', async (c) => {
  const userId = c.get('userId') as string;
  const rows = await achievementRepo.listByUser(userId);
  const out: UserAchievement[] = rows.map((r) => ({
    achievementId: r.achievementId,
    unlockedAt: r.unlockedAt,
    sessionId: r.sessionId,
  }));
  return c.json(UserAchievementsResponseSchema.parse(out));
});
