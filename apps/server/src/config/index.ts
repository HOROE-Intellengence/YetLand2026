// 服务端运行时配置 — 多数从 Env 读，少数从 Postgres `app_config` 表读（运营可改的部分）
import { DEFAULT_GLOBAL_BOUNDARY } from '@yelan/shared';
import type { Env } from '../types/bindings';

export interface AppConfig {
  narrativeBoundaryGlobal: 1 | 2 | 3 | 4 | 5;
  registerGrant: number;          // 注册一次性发烛数
  freeRoundLimit: number;         // 默认 20
  dailyCostHardCutoffUsd: number; // 默认 5
  dailyCostDegradeUsd: number;    // 默认 2
}

export function defaultConfig(env: Env): AppConfig {
  return {
    narrativeBoundaryGlobal: Number(env.NARRATIVE_BOUNDARY_GLOBAL ?? DEFAULT_GLOBAL_BOUNDARY) as AppConfig['narrativeBoundaryGlobal'],
    registerGrant: 100,
    freeRoundLimit: 20,
    dailyCostHardCutoffUsd: 5,
    dailyCostDegradeUsd: 2,
  };
}
