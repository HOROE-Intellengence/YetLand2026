import { beforeEach, expect, it } from 'vitest';
import { store } from '../store/persistence';
import { memoryScopeKey } from './memory-scope';
import { voiceMemoryContext, voiceMemoryScope } from './voice-memory';

beforeEach(() => store.__resetForTests());
it('ordinary voice reads the same scoped profile as text and phone', () => {
  store.state().scopedMemoryProfiles = {
    [memoryScopeKey('u1', 'c1', { mode: 'main' })]: { markdown: '角色送给用户银色胸针', updatedAt: 'now' },
  };
  const scope = voiceMemoryScope('u1', 'c1', 'ordinary');
  expect(voiceMemoryContext('u1', 'c1', 'ordinary', scope)).toContain('银色胸针');
  expect(voiceMemoryContext('u2', 'c1', 'ordinary', scope)).not.toContain('银色胸针');
  expect(voiceMemoryContext('u1', 'c2', 'ordinary', scope)).not.toContain('银色胸针');
});
it('keeps phone branches and IF separate and rejects foreign session context', () => {
  store.state().phoneVoiceSessions = { phone: { userId: 'u1', characterId: 'c1', mode: 'main', branchId: 'story:a', context: '主线临时上下文' } };
  expect(voiceMemoryScope('u1', 'c1', 'phone')).toMatchObject({ mode: 'main', branchId: 'story:a' });
  const ifScope = voiceMemoryScope('u1', 'c1', 'phone', true);
  expect(ifScope.mode).toBe('if');
  expect(voiceMemoryContext('u1', 'c1', 'phone', ifScope)).not.toContain('主线临时上下文');
  expect(voiceMemoryScope('u2', 'c1', 'phone').branchId).toBeUndefined();
  expect(voiceMemoryContext('u2', 'c1', 'phone', { mode: 'main' })).not.toContain('主线临时上下文');
});
