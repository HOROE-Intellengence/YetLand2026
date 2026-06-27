import { api } from './client';
import type { Achievement, UserAchievement } from '@yelan/shared';

export const listAchievements = () => api<Achievement[]>('/api/achievements');
export const myAchievements = () => api<UserAchievement[]>('/api/me/achievements');
