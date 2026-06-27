// 星座数据结构 —— 唯一真理源。
// 渲染层（web ConstellationField / admin 编辑器）、持久化层（api）、契约层（zod）共用此类型。
export interface ConstellationPoint {
  id: string;
  x: number; // 0..100
  y: number; // -40..100，y < 0 时浮于卡片上边界之上
}

export interface ConstellationEdge {
  from: string;
  to: string;
}

export interface Constellation {
  points: ConstellationPoint[];
  edges: ConstellationEdge[];
}
