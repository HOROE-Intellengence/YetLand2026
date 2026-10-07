import type { ApiConfig } from './settings-types';
import { isYelanManaged } from './yelan-managed-client';

export function scopedYelanConfig(config: ApiConfig, source: 'story' | 'vn' | 'map' | 'game', sessionId?: string): ApiConfig {
  if (!isYelanManaged) return config;
  // First-turn generation without persisted history must never read mainline memory.
  return { ...config, yelanBranchId: `${source}:${sessionId || 'uncommitted'}` };
}
