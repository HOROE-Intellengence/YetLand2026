// 来源: prototype/particles.jsx
// 职责: 背景粒子（烛火飞屑），强度跟随 stage / candle / 用户 tweaks
// TODO: 移植 canvas 实现 + 性能降级（低端机减粒子数）
export function ParticleField() {
  return <canvas style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} />;
}
