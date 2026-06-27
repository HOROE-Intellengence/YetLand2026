export interface Achievement {
  id: string;
  slug: string;
  name: string;
  rewardCandle: number;
  description: string;
}

export interface UserAchievement {
  achievementId: string;
  unlockedAt: string;
  sessionId?: string;
}
