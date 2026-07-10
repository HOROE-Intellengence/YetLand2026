// 来源: prototype/app.jsx
// 职责: 场景编排（intro / opening / select / chat / end）+ 全局抽屉 + 调参面板
// TODO: 从 prototype/app.jsx 增量移植；状态搬到 stores/sessionStore.ts

import { useEffect } from 'react';
import { useSessionStore } from './stores/sessionStore';
import { usePreferencesStore } from './stores/preferencesStore';
import { useViewport } from './hooks/useViewport';
import { fullSync, startSyncTimer, stopSyncTimer } from './memory/sync';
import { LandingScene } from './scenes/LandingScene';
import { IntroScene } from './scenes/IntroScene';
import { OpeningScene } from './scenes/OpeningScene';
import { LoginScene } from './scenes/LoginScene';
import { NameScene } from './scenes/NameScene';
import { CharacterSelect } from './scenes/CharacterSelect';
import { CharacterCreate } from './scenes/CharacterCreate';
import { Conversation } from './scenes/Conversation';
import { NarrativeCutoff } from './scenes/NarrativeCutoff';
import { ParticleField } from './components/particles/ParticleField';
import { DrawerRail, DrawerShell } from './components/drawer';
import { AchievementFlash } from './components/achievement/AchievementFlash';
import { TweaksPanel } from './components/tweaks/TweaksPanel';

export default function App() {
  const scene = useSessionStore((s) => s.scene);
  const fetchPreferences = usePreferencesStore((s) => s.fetch);
  const theme = usePreferencesStore((s) => s.theme);
  const fontScale = usePreferencesStore((s) => s.fontScale);
  const { lowEndDevice, prefersReducedMotion } = useViewport();

  useEffect(() => {
    void fetchPreferences();
    void fullSync();
    startSyncTimer();
    return () => stopSyncTimer();
  }, [fetchPreferences]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.setProperty('--user-font-scale', String(fontScale));
  }, [theme, fontScale]);

  // 设备/偏好分档：低端机或「减少动态效果」→ data-motion=reduced，供重特效降级（移动端方案 Phase 5）
  useEffect(() => {
    document.documentElement.dataset.motion =
      prefersReducedMotion || lowEndDevice ? 'reduced' : 'full';
  }, [lowEndDevice, prefersReducedMotion]);

  return (
    <div className="app-root">
      <ParticleField />

      {scene === 'home' && <LandingScene />}
      {scene === 'intro' && <IntroScene />}
      {scene === 'opening' && <OpeningScene />}
      {scene === 'login' && <LoginScene />}
      {scene === 'name' && <NameScene />}
      {scene === 'select' && <CharacterSelect />}
      {scene === 'create' && <CharacterCreate />}
      {scene === 'chat' && <Conversation />}
      {scene === 'end' && <NarrativeCutoff />}

      <AchievementFlash />

      {(scene === 'chat' || scene === 'select') && <DrawerRail />}
      <DrawerShell />

      {/* 仅 dev 环境挂载 */}
      {import.meta.env.DEV && <TweaksPanel />}
    </div>
  );
}
