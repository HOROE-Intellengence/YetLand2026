// 烛"光态"派生 — 见开发文档 §三.3
// 阈值基于注册一次性发放量；后台运营配置可下发 registerGrant 调整
import type { CandleState } from '@yelan/shared';

export function candleState(balance: number, registerGrant: number): CandleState {
  if (balance > registerGrant * 0.5) return 'full';
  if (balance > registerGrant * 0.15) return 'mid';
  return 'low';
}
