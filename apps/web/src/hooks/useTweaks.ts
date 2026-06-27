// dev 调参面板的状态钩子，自动持久化到 localStorage
// TODO: 实际移植自 prototype/tweaks-panel.jsx 的 useTweaks
import { useState } from 'react';

export function useTweaks<T extends Record<string, unknown>>(defaults: T) {
  const [state, set] = useState<T>(defaults);
  const setKey = <K extends keyof T>(key: K, value: T[K]) =>
    set((prev) => ({ ...prev, [key]: value }));
  return [state, setKey] as const;
}
