// 客户端 feature flag 默认值；服务端可通过 /api/admin/config 的 featureFlags 块覆盖
export const featureFlags = {
  ifLineHinted: false,        // 主线是否展示 IF 暗示（默认关）
  longImageExport: false,     // 长图导出（W10）
  cardStore: false,           // 角色卡商店（Phase 1 不上线）
  ageGate: false,             // 年龄验证（Phase 1 不做）

  // 抽屉面板级开关 — 灰测由服务端 env 控制
  FEATURE_ACHIEVEMENTS: true,
  FEATURE_DRAWER_YOU: true,
  FEATURE_DRAWER_SUBS: true,
  FEATURE_DRAWER_CANDLE: true,
  FEATURE_DRAWER_LIBRARY: true,
  FEATURE_DRAWER_MEMORY: true,
  FEATURE_DRAWER_SEAL: true,
  FEATURE_DRAWER_SURVEY: true,
  FEATURE_DRAWER_BREATH: true,
};

export type FeatureFlag = keyof typeof featureFlags;
