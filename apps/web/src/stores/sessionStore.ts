// 会话级全局状态 — 场景切换 / 当前角色 / 当前 stage / boundary / 成就闪屏
import { create } from 'zustand';
import { DEFAULT_USER_BOUNDARY, type Character, type Stage, type Boundary } from '@yelan/shared';

type Scene = 'home' | 'intro' | 'opening' | 'call-modes' | 'login' | 'name' | 'select' | 'create' | 'chat' | 'end' | 'voice' | 'voice-hq' | 'api' | 'phone';

interface SessionState {
  goCallModes: () => void;
  phoneLogin: boolean;
  goPhone: () => void;
  goPhoneLogin: () => void;
  apiLogin: boolean;
  goApi: () => void;
  goApiLogin: () => void;
  scene: Scene;
  voiceLogin: boolean;
  hqVoiceLogin: boolean;
  goHqVoice: () => void;
  goHqVoiceLogin: () => void;
  goVoice: () => void;
  goVoiceLogin: () => void;
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
  finishLogin: (name?: string) => void;
  cancelLogin: () => void;
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
  goCallModes: () => set({ scene: 'call-modes', phoneLogin: false, hqVoiceLogin: false, voiceLogin: false, apiLogin: false }),
  phoneLogin: false,
  goPhone: () => set({ scene: 'phone', phoneLogin: false, apiLogin: false, voiceLogin: false, hqVoiceLogin: false }),
  goPhoneLogin: () => set({ scene: 'login', phoneLogin: true, apiLogin: false, voiceLogin: false, hqVoiceLogin: false }),
  apiLogin: false,
  goApi: () => set({ scene: 'api', phoneLogin: false, apiLogin: false, voiceLogin: false }),
  goApiLogin: () => set({ scene: 'login', phoneLogin: false, hqVoiceLogin: false, apiLogin: true, voiceLogin: false }),
  hqVoiceLogin: false,
  goHqVoice: () => set({ scene: 'voice-hq', phoneLogin: false, voiceLogin: false, apiLogin: false, hqVoiceLogin: false }),
  goHqVoiceLogin: () => set({ scene: 'login', phoneLogin: false, voiceLogin: false, apiLogin: false, hqVoiceLogin: true }),
  scene: 'home',
  voiceLogin: false,
  goVoice: () => set({ scene: 'voice', phoneLogin: false, voiceLogin: false }),
  goVoiceLogin: () => set({ scene: 'login', phoneLogin: false, hqVoiceLogin: false, voiceLogin: true, apiLogin: false }),
  greeting: '',
  userName: '',
  character: null,
  stage: 'daily',
  boundary: DEFAULT_USER_BOUNDARY,
  temperature: 3,
  achievement: null,

  goIntro: () => set({ scene: 'intro' }),
  goOpening: () => set({ scene: 'opening', phoneLogin: false }),
  goLogin: () => set({ scene: 'login', phoneLogin: false, hqVoiceLogin: false, voiceLogin: false, apiLogin: false }),
  finishLogin: (name) => set((state) => ({
    scene: state.phoneLogin ? 'phone' : state.hqVoiceLogin ? 'voice-hq' : state.apiLogin ? 'api' : state.voiceLogin ? 'voice' : name ? 'select' : 'name',
    phoneLogin: false,
    userName: name ?? '',
    character: null,
    stage: 'daily',
    boundary: DEFAULT_USER_BOUNDARY,
    temperature: 3,
    achievement: null,
    hqVoiceLogin: false,
    voiceLogin: false,
    apiLogin: false,
  })),
  cancelLogin: () => set((state) => ({
    scene: state.phoneLogin ? 'phone' : state.hqVoiceLogin ? 'voice-hq' : state.apiLogin ? 'api' : state.voiceLogin ? 'voice' : 'opening',
    phoneLogin: false,
    hqVoiceLogin: false,
    voiceLogin: false,
    apiLogin: false,
  })),
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
  restart: () => set({ scene: 'intro', phoneLogin: false, hqVoiceLogin: false, character: null, greeting: '', userName: '', stage: 'daily', boundary: DEFAULT_USER_BOUNDARY, temperature: 3, voiceLogin: false, apiLogin: false }),
}));

export interface AchievementNotice {
  id?: string;
  slug: string;
  name?: string;
  rewardCandle?: number;
  description?: string;
}
