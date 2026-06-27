// 抽屉外壳：根据 useDrawerStore.openId 切换面板
import type { ComponentType } from 'react';
import { useDrawerStore } from '../../stores/drawerStore';
import type { DrawerId } from './index';
import * as Panels from './panels';
import styles from './DrawerShell.module.css';

const PANEL_MAP: Record<DrawerId, ComponentType> = {
  you: Panels.YouPanel,
  subs: Panels.SubscriptionsPanel,
  candle: Panels.CandleLedgerPanel,
  library: Panels.LibraryPanel,
  memory: Panels.MemoryPanel,
  seal: Panels.SealPanel,
  survey: Panels.SurveyPanel,
  breath: Panels.BreathPanel,
};

export function DrawerShell() {
  const openId = useDrawerStore((s) => s.openId);
  const close = useDrawerStore((s) => s.close);

  if (!openId) return null;
  const Panel = PANEL_MAP[openId];

  return (
    <>
      <div className={styles.overlay} onClick={close} />
      <aside className={styles.shell}>
        <button className={styles.closeBtn} onClick={close} aria-label="关闭">
          ×
        </button>
        <Panel />
      </aside>
    </>
  );
}
