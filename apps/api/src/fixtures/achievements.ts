import type { Achievement, UserAchievement } from '@yelan/shared';

export const mockAchievements: Achievement[] = [
  { id: 'ach_1', slug: 'obsession', name: '执念',  rewardCandle: 50,  description: '连续 5 轮未退出且互动强度上升' },
  { id: 'ach_2', slug: 'confession', name: '告白', rewardCandle: 30,  description: '首次说出明确情感表达' },
  { id: 'ach_3', slug: 'remember', name: '旧识',   rewardCandle: 80,  description: '提到 3 天前的记忆并被召回' },
  { id: 'ach_4', slug: 'midnight', name: '深夜',   rewardCandle: 40,  description: '0-4 点进入对话' },
  { id: 'ach_5', slug: 'farewell', name: '离别',   rewardCandle: 100, description: '7 日后首次回归' },
];

export const mockUserAchievements: UserAchievement[] = [];
