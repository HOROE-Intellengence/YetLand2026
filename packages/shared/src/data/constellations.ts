// 内置星座默认数据集 —— 既作 api 首启 seed 的种子，也作 web 离线/未匹配时的兜底。
// 运营在 admin 编辑后，持久化数据覆盖这里；此处只负责「从未编辑过」时的体面回退。
import type { Constellation } from '../types/constellation';

export const DEFAULT_CONSTELLATIONS: Record<string, Constellation> = {
  // 沈言志 星座：钻石心/皇冠状
  'shen-yan-zhi': {
    points: [
      { id: 'A', x: 50, y: -25 }, // 悬浮于卡片上方，顶部中央
      { id: 'B', x: 25, y: -10 }, // 悬浮于卡片上方，左侧
      { id: 'C', x: 75, y: -10 }, // 悬浮于卡片上方，右侧
      { id: 'D', x: 50, y: 15 },  // 下探入卡片内部
      { id: 'E', x: 35, y: 45 },  // 卡片中下部左侧
      { id: 'F', x: 65, y: 45 },  // 卡片中下部右侧
    ],
    edges: [
      { from: 'A', to: 'B' },
      { from: 'A', to: 'C' },
      { from: 'B', to: 'D' },
      { from: 'C', to: 'D' },
      { from: 'D', to: 'E' },
      { from: 'D', to: 'F' },
      { from: 'E', to: 'F' },
    ],
  },

  // 江白 星座：沙漏/双三角状
  'jiang-bai': {
    points: [
      { id: 'A', x: 30, y: -30 }, // 悬浮于卡片上方
      { id: 'B', x: 70, y: -30 }, // 悬浮于卡片上方
      { id: 'C', x: 50, y: -10 }, // 悬浮于卡片上方，汇聚点
      { id: 'D', x: 30, y: 20 },  // 下探至卡片内部
      { id: 'E', x: 70, y: 20 },  // 下探至卡片内部
      { id: 'F', x: 50, y: 55 },  // 底部基座点
    ],
    edges: [
      { from: 'A', to: 'C' },
      { from: 'B', to: 'C' },
      { from: 'C', to: 'D' },
      { from: 'C', to: 'E' },
      { from: 'D', to: 'F' },
      { from: 'E', to: 'F' },
    ],
  },
};

// 通用兜底星座：经典四边形星轨
export const FALLBACK_CONSTELLATION: Constellation = {
  points: [
    { id: 'A', x: 50, y: -20 }, // 悬浮于卡片上方
    { id: 'B', x: 20, y: 15 },  // 下探入卡片内部
    { id: 'C', x: 80, y: 15 },  // 下探入卡片内部
    { id: 'D', x: 50, y: 45 },  // 底部中心点
  ],
  edges: [
    { from: 'A', to: 'B' },
    { from: 'A', to: 'C' },
    { from: 'B', to: 'D' },
    { from: 'C', to: 'D' },
  ],
};

/** 按角色 slug 取内置默认星座，未匹配则返回漂亮的通用兜底。 */
export function getDefaultConstellation(slug: string): Constellation {
  return DEFAULT_CONSTELLATIONS[slug] ?? FALLBACK_CONSTELLATION;
}
