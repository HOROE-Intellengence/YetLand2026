// 边缘滑入手势 —— 移动端适配长期方案 Phase 4（D1：边缘右滑唤出 + 可见入口）
//
// 复用选角页的 pointer 拖拽判定（CharacterSelect.tsx：起手记录 x、抬手比阈值）。
// 只认 pointerType=touch，避免桌面鼠标在边缘拖拽误触；水平位移须大于纵向，过滤纵向滚动。
// 几何判定抽成纯函数（isInEdgeZone / isSwipeTriggered）便于在无 DOM 的 node 测试覆盖。
import { useEffect } from 'react';

export type SwipeEdge = 'left' | 'right';

const DEFAULT_EDGE_ZONE = 28; // 起手必须落在距边缘的这个像素带内
const DEFAULT_THRESHOLD = 50; // 触发所需的最小水平位移

/** 起手点是否落在指定边缘的感应带内 */
export function isInEdgeZone(
  x: number,
  edge: SwipeEdge,
  viewportWidth: number,
  edgeZone: number = DEFAULT_EDGE_ZONE,
): boolean {
  return edge === 'left' ? x <= edgeZone : x >= viewportWidth - edgeZone;
}

/** 位移是否构成「从该边缘滑入」：右缘需向左（dx 负）、左缘需向右（dx 正），且以水平为主 */
export function isSwipeTriggered(
  dx: number,
  dy: number,
  edge: SwipeEdge,
  threshold: number = DEFAULT_THRESHOLD,
): boolean {
  if (Math.abs(dx) <= Math.abs(dy)) return false; // 纵向为主 → 视为滚动，不触发
  return edge === 'left' ? dx > threshold : dx < -threshold;
}

interface EdgeSwipeOptions {
  edge?: SwipeEdge;
  edgeZone?: number;
  threshold?: number;
  enabled?: boolean;
  onSwipe: () => void;
}

export function useEdgeSwipe({
  edge = 'right',
  edgeZone = DEFAULT_EDGE_ZONE,
  threshold = DEFAULT_THRESHOLD,
  enabled = true,
  onSwipe,
}: EdgeSwipeOptions): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;

    let startX = 0;
    let startY = 0;
    let tracking = false;

    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return; // 仅触屏
      if (!isInEdgeZone(e.clientX, edge, window.innerWidth, edgeZone)) return;
      tracking = true;
      startX = e.clientX;
      startY = e.clientY;
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      if (isSwipeTriggered(e.clientX - startX, e.clientY - startY, edge, threshold)) {
        onSwipe();
      }
    };

    const onPointerCancel = () => {
      tracking = false;
    };

    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);

    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
    };
  }, [edge, edgeZone, threshold, enabled, onSwipe]);
}
