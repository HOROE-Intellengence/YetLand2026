import { z } from 'zod';

export const AchievementResponseSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  rewardCandle: z.number(),
  description: z.string(),
});

export const AchievementsListResponseSchema = z.array(AchievementResponseSchema);

export const UserAchievementResponseSchema = z.object({
  achievementId: z.string(),
  unlockedAt: z.string(),
  sessionId: z.string().optional(),
});

export const UserAchievementsResponseSchema = z.array(UserAchievementResponseSchema);

export type AchievementResponse = z.infer<typeof AchievementResponseSchema>;
export type AchievementsListResponse = z.infer<typeof AchievementsListResponseSchema>;
export type UserAchievementResponse = z.infer<typeof UserAchievementResponseSchema>;
export type UserAchievementsResponse = z.infer<typeof UserAchievementsResponseSchema>;
