// 会话级全局状态 — 场景切换 / 当前角色 / 当前 stage / boundary / 成就闪屏
import { create } from 'zustand';
import { DEFAULT_USER_BOUNDARY, type Character, type Stage, type Boundary } from '@yelan/shared';

type Scene = 'home' | 'intro' | 'opening' | 'login' | 'name' | 'select' | 'create' | 'chat' | 'end';

interface SessionState {
  scene: Scene;
  greeting: string;
  userName: string;
  character: Character | null;
  stage: Stage;
  boundary: Boundary;
  temperature: number;
  achievement: AchievementNotice | null;

  goIntro: () => void;
  goOpening: () => void;
  goLogin: () => void;
  setGreeting: (g: string) => void;
  setUserName: (name: string) => void;
  goSelect: () => void;
  goCreate: () => void;
  pickCharacter: (c: Character) => void;
  setStage: (s: Stage) => void;
  setBoundary: (b: Boundary) => void;
  setTemperature: (t: number) => void;
  pushAchievement: (a: AchievementNotice) => void;
  clearAchievement: () => void;
  cutoff: () => void;
  restart: () => void;
}

export const useSessionStore = create<SessionState>((set) => ({
  scene: 'home',
  greeting: '',
  userName: '',
  character: null,
  stage: 'daily',
  boundary: DEFAULT_USER_BOUNDARY,
  temperature: 3,
  achievement: null,

  goIntro: () => set({ scene: 'intro' }),
  goOpening: () => set({ scene: 'opening' }),
  goLogin: () => set({ scene: 'login' }),
  setGreeting: (greeting) => set({ greeting, scene: 'name' }),
  setUserName: (userName) => set({ userName, scene: 'select' }),
  goSelect: () => set({ scene: 'select' }),
  goCreate: () => set({ scene: 'create' }),
  pickCharacter: (character) => set({ character, scene: 'chat' }),
  setStage: (stage) => set({ stage }),
  setBoundary: (boundary) => set({ boundary }),
  setTemperature: (temperature) => set({ temperature }),
  pushAchievement: (achievement) => set({ achievement }),
  clearAchievement: () => set({ achievement: null }),
  cutoff: () => set({ scene: 'end' }),
  restart: () => set({ scene: 'intro', character: null, greeting: '', userName: '', stage: 'daily', boundary: DEFAULT_USER_BOUNDARY, temperature: 3 }),
}));

export interface AchievementNotice {
  id?: string;
  slug: string;
  name?: string;
  rewardCandle?: number;
  description?: string;
}
