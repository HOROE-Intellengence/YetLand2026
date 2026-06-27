// 读全局合规上限（环境变量）。effectiveBoundary 纯逻辑见 @yelan/shared。
import { DEFAULT_GLOBAL_BOUNDARY, type Boundary } from '@yelan/shared';

export function getGlobalBoundary(): Boundary {
  const raw = Number(process.env.NARRATIVE_BOUNDARY_GLOBAL ?? DEFAULT_GLOBAL_BOUNDARY);
  if (raw >= 1 && raw <= 5) return raw as Boundary;
  return DEFAULT_GLOBAL_BOUNDARY;
}
