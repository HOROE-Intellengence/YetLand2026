// 来源: prototype/tweaks-panel.jsx
// 职责: 仅 dev 环境的调试面板 — 强制 stage / candle / 触发成就 / 跳转抽屉 / 重启
// 注: 序列化形态需保持 prototype 的 EDITMODE-BEGIN/END 协议（设计师/PM 可视化调参依赖）

import { useTweaks } from '../../hooks/useTweaks';
export { TweakSection } from './TweakSection';
export { TweakSelect } from './TweakSelect';
export { TweakSlider } from './TweakSlider';
export { TweakButton } from './TweakButton';

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/ {
  stage: 'auto',
  candle: 'auto',
  particle: 1.0,
} /*EDITMODE-END*/ as const;

export function TweaksPanel() {
  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);
  void tweaks;
  void setTweak;
  // TODO 移植完整面板
  return null;
}
