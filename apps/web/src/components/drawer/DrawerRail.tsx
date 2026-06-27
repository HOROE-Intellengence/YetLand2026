// 抽屉导航条（屏幕侧边的极简 affordance）
// 桌面：8 按钮竖排常显（行为不变）。
// 移动（coarse pointer）：收成单一可见入口（railToggle），点按或右缘滑入才展开列表（移动端方案 Phase 4 / D1）。
import { useState } from 'react';
import { useDrawerStore } from '../../stores/drawerStore';
import { useEdgeSwipe } from '../../hooks/useEdgeSwipe';
import type { DrawerId } from './index';
import styles from './DrawerRail.module.css';

const RAIL_ITEMS: { id: DrawerId; label: string }[] = [
  { id: 'you', label: '你' },
  { id: 'subs', label: '续夜' },
  { id: 'candle', label: '烛账' },
  { id: 'library', label: '书阁' },
  { id: 'memory', label: '记事' },
  { id: 'seal', label: '印' },
  { id: 'survey', label: '一问' },
  { id: 'breath', label: '调息' },
];

export function DrawerRail() {
  const open = useDrawerStore((s) => s.open);
  const [expanded, setExpanded] = useState(false);

  // 右缘滑入 → 展开导航（仅触屏触发）
  useEdgeSwipe({ edge: 'right', onSwipe: () => setExpanded(true) });

  const handlePick = (id: DrawerId) => {
    open(id);
    setExpanded(false);
  };

  return (
    <nav className={`${styles.rail} ${expanded ? styles.railOpen : ''}`}>
      <button
        className={styles.railToggle}
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? '收起导航' : '展开导航'}
        aria-expanded={expanded}
        title="导航"
      >
        {expanded ? '×' : '≡'}
      </button>
      <div className={styles.railList}>
        {RAIL_ITEMS.map((item) => (
          <button
            key={item.id}
            className={styles.railBtn}
            onClick={() => handlePick(item.id)}
            title={item.label}
          >
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
