// 前端 stage 镜像：服务端是真理源，但前端在 SSE 元数据里收到当前 stage
// 本工具仅用于"在 server stage 元数据缺失时"做兜底（如 mock 模式）
import type { Stage } from '@yelan/shared';

export function fallbackStage(round: number): Stage {
  if (round < 4) return 'daily';
  if (round < 8) return 'rise';
  if (round < 12) return 'climax';
  return 'after';
}
