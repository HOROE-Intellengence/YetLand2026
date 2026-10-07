import { describe, expect, it, vi } from 'vitest';
vi.mock('./yelan-managed-client', () => ({ isYelanManaged: true }));
import { scopedYelanConfig } from './yelan-memory-scope';
import type { ApiConfig } from './settings-types';

describe('request-local phone branch scope', () => {
  const config: ApiConfig = { id: 'yelan:a', provider: 'Custom', apiKey: 'server-managed', defaultModel: 'yelan-managed', enableImageRecognition: true, enableImageGeneration: false };
  it('keeps concurrent branches separate without mutating the shared role config', () => {
    const first = scopedYelanConfig(config, 'story', 'one');
    const second = scopedYelanConfig(config, 'story', 'two');
    expect(first.yelanBranchId).toBe('story:one');
    expect(second.yelanBranchId).toBe('story:two');
    expect(config.yelanBranchId).toBeUndefined();
    expect(scopedYelanConfig(config, 'vn', 'one').yelanBranchId).toBe('vn:one');
  });
  it('does not read mainline memory for an empty first-turn history', () => {
    expect(scopedYelanConfig(config, 'map').yelanBranchId).toBe('map:uncommitted');
  });
});
