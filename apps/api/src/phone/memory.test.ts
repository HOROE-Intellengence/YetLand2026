import { beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '../store/persistence';
import { ingestPhoneMemory, readPhoneMemory } from './memory';
import { sidecarCallWithSchema } from '../sidecar-ai/client';
import { getUserProfile, recordPreference } from '../sidecar-ai/preference-recorder';
import { deleteAllMemories } from '../services/memories';

vi.mock('../services/characters', () => ({ charactersService: {
  get: (id: string) => ({ id, isActive: true }),
  canAccess: (id: string, userId: string) => id !== 'private' || userId === 'owner',
} }));
vi.mock('../sidecar-ai/client', () => ({
  sidecarReady: () => true,
  sidecarCallWithSchema: vi.fn(),
}));

const event = { eventId: 'e1', sourceApp: 'moments' as const, characterId: 'shen', mode: 'main' as const, text: '明天面试' };
const result = { ok: true, data: { preferences: [{ text: '喜欢无糖咖啡', category: 'preference' }],
  events: [{ date: '今天', text: '明天面试' }], relationshipState: '朋友', summary: '明天面试，喜欢无糖咖啡' } };

describe('phone shared memory', () => {
  beforeEach(() => {
    store.__resetForTests();
    store.state().sidecarEnabled.preferenceRecorder = true;
    vi.mocked(sidecarCallWithSchema).mockReset().mockResolvedValue(result);
  });

  it('shares across applications but isolates users, characters, modes and branches', async () => {
    await ingestPhoneMemory('u1', event);
    expect(readPhoneMemory('u1', event)).toContain('明天面试');
    expect(readPhoneMemory('u2', event)).not.toContain('明天面试');
    expect(readPhoneMemory('u1', { ...event, characterId: 'other' })).not.toContain('明天面试');
    expect(readPhoneMemory('u1', { ...event, mode: 'if' })).not.toContain('明天面试');
    expect(readPhoneMemory('u1', { ...event, branchId: 'fiction' })).not.toContain('明天面试');
    await ingestPhoneMemory('u1', { ...event, eventId: 'branch-event', branchId: 'fiction', mode: 'if' });
    expect(readPhoneMemory('u1', { ...event, branchId: 'fiction', mode: 'if' })).toContain('明天面试');
    expect(Object.values(store.state().userEvents).some(row => row.mode === 'if')).toBe(true);
  });

  it('deduplicates in-flight and persisted events, rejects ID reuse with changed content', async () => {
    const outputs = await Promise.all([ingestPhoneMemory('u1', event), ingestPhoneMemory('u1', event)]);
    expect(outputs.filter(output => output.duplicate)).toHaveLength(1);
    expect(sidecarCallWithSchema).toHaveBeenCalledTimes(1);
    expect((await ingestPhoneMemory('u1', event)).duplicate).toBe(true);
    await expect(ingestPhoneMemory('u1', { ...event, text: 'changed' })).rejects.toMatchObject({ status: 409 });
  });

  it('retries failures without marking the source as successfully recorded', async () => {
    vi.mocked(sidecarCallWithSchema).mockResolvedValueOnce({ ok: false, error: 'failed' });
    await expect(ingestPhoneMemory('u1', event)).rejects.toMatchObject({ status: 503 });
    expect(Object.values(store.state().phoneMemoryReceipts!)[0]?.status).toBe('failed');
    await expect(ingestPhoneMemory('u1', event)).resolves.toEqual({ ok: true, duplicate: false });
  });

  it('blocks private-character reads and writes before any model call', async () => {
    await expect(ingestPhoneMemory('stranger', { ...event, characterId: 'private' })).rejects.toMatchObject({ status: 404 });
    expect(() => readPhoneMemory('stranger', { ...event, characterId: 'private' })).toThrow('CHARACTER_NOT_FOUND');
    expect(sidecarCallWithSchema).not.toHaveBeenCalled();
  });

  it('does not inject legacy global relationship summaries or replace legacy chat behavior', async () => {
    store.state().userProfiles.u1 = { markdown: '- 用户称呼名：小林\n与别的角色已婚', updatedAt: 'now' };
    await ingestPhoneMemory('u1', event);
    expect(readPhoneMemory('u1', event)).toContain('小林');
    expect(readPhoneMemory('u1', event)).not.toContain('已婚');
    expect(getUserProfile('u1')).toContain('已婚');
    await recordPreference('u1', 'shen', '普通聊天', 's1');
    expect(getUserProfile('u1')).toContain('明天面试');
  });

  it('clears the new scoped profiles and receipts through the existing memory-delete service', async () => {
    await ingestPhoneMemory('u1', event);
    await ingestPhoneMemory('u2', event);
    deleteAllMemories('u1');
    expect(readPhoneMemory('u1', event)).toBe('');
    expect(readPhoneMemory('u2', event)).toContain('明天面试');
    expect(Object.values(store.state().phoneMemoryReceipts!).some(row => row.userId === 'u1')).toBe(false);
  });
});
