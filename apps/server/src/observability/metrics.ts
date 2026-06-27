// Grafana 指标推送 — Workers 友好的 OTLP HTTP / Influx Line Protocol
// 关键指标：单用户成本（CTO 看），转化漏斗（PM 看）
export interface Metric {
  name: string;
  value: number;
  tags?: Record<string, string>;
  ts?: number;
}

export function metric(_m: Metric) {
  // TODO: 缓冲到 batch，每 5s flush 一次
}
