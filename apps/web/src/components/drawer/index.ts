// 来源: prototype/drawer.jsx
// 8 个抽屉面板对应 §四产品需求中的：你 / 续夜 / 烛账 / 书阁 / 记事 / 印 / 一问 / 调息

export { DrawerRail } from './DrawerRail';
export { DrawerShell } from './DrawerShell';

export type DrawerId =
  | 'you'
  | 'subs'
  | 'candle'
  | 'library'
  | 'memory'
  | 'seal'
  | 'survey'
  | 'breath';
