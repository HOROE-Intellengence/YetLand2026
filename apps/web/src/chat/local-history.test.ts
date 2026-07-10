import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadLocalChat, migrateLocalChatOwner, saveLocalChat, type LocalChatSnapshot } from './local-history';

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

describe('migrateLocalChatOwner', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    installLocalStorage();
  });

  it('reassigns device-scoped chats to the account id and rewrites ownerUserId', () => {
    saveLocalChat(snapshot('dev_abc'));

    const moved = migrateLocalChatOwner('dev_abc', 'user-real');

    expect(moved).toBe(1);
    expect(loadLocalChat('char-1', 'dev_abc')).toBeNull();
    const adopted = loadLocalChat('char-1', 'user-real');
    expect(adopted?.sessionId).toBe('session-dev_abc');
    expect(adopted?.ownerUserId).toBe('user-real');
  });

  it('keeps the account chat and drops the device chat on collision', () => {
    // 账号名下已有对话（不同 sessionId）；设备名下也有一份 —— 迁移不得覆盖账号的。
    localStorage.setItem(
      'yelan.chatSession.user-real.char-1',
      JSON.stringify({ ...snapshot('user-real'), sessionId: 'session-account' }),
    );
    saveLocalChat(snapshot('dev_abc'));

    const moved = migrateLocalChatOwner('dev_abc', 'user-real');

    expect(moved).toBe(0);
    expect(loadLocalChat('char-1', 'dev_abc')).toBeNull(); // 源仍被清掉
    expect(loadLocalChat('char-1', 'user-real')?.sessionId).toBe('session-account');
  });

  it('is a no-op when from and to are equal or empty', () => {
    saveLocalChat(snapshot('user-real'));

    expect(migrateLocalChatOwner('user-real', 'user-real')).toBe(0);
    expect(migrateLocalChatOwner('', 'user-real')).toBe(0);
    expect(loadLocalChat('char-1', 'user-real')?.sessionId).toBe('session-user-real');
  });
});
