// 告警触发条件 — 阈值见 docs/开发文档.md §六 运维体系
// 实际通知通道（飞书 / 钉钉 / PagerDuty）由 Grafana / 自建脚本完成
export type AlertLevel = 'P0' | 'P1' | 'P2';

export function shouldAlertCostSpike(spentTodayUSD: number, dailyBudgetUSD: number): AlertLevel | null {
  if (spentTodayUSD > dailyBudgetUSD * 1.5) return 'P0';
  if (spentTodayUSD > dailyBudgetUSD) return 'P1';
  return null;
}
