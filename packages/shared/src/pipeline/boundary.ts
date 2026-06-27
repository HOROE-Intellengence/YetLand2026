// 合规取最小：min(用户值, 全局上限)。api / server 共用的纯逻辑。
import type { Boundary } from '../enums/boundary';

export function effectiveBoundary(userBoundary: Boundary, globalMax: Boundary): Boundary {
  return Math.min(userBoundary, globalMax) as Boundary;
}
