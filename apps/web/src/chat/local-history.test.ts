import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLocalChat, saveLocalChat, type LocalChatSnapshot } from './local-history';

function installLocalStorage() {
  const data = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    removeItem: (key: string) => data.delete(key),
    setItem: (key: string, value: string) => data.set(key, String(value)),
  });
}

function snapshot(ownerUserId: string): LocalChatSnapshot {
  return {
    version: 2,
    characterId: 'char-1',
    ownerUserId,
    sessionId: `session-${ownerUserId}`,
    messages: [{ role: 'assistant', content: 'hello' }],
    structuredParts: {},
    round: 1,
    stage: 'daily',
    boundary: 3,
    temperature: 3,
    updatedAt: new Date().toISOString(),
  };
}

describe('local chat history account isolation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installLocalStorage();
  });

  it('loads only the current user scoped chat key', () => {
    saveLocalChat(snapshot('user-a'));
    saveLocalChat(snapshot('user-b'));

    expect(loadLocalChat('char-1', 'user-b')?.sessionId).toBe('session-user-b');
    expect(loadLocalChat('char-1', 'user-a')?.sessionId).toBe('session-user-a');
  });

  it('rejects snapshots whose ownerUserId does not match the scoped key user', () => {
    localStorage.setItem('yelan.chatSession.user-b.char-1', JSON.stringify(snapshot('user-a')));

    expect(loadLocalChat('char-1', 'user-b')).toBeNull();
  });

  it('does not read legacy character-only chat keys', () => {
    localStorage.setItem('yelan.chatSession.char-1', JSON.stringify({ ...snapshot('user-a'), version: 1 }));

    expect(loadLocalChat('char-1', 'user-b')).toBeNull();
  });
});
