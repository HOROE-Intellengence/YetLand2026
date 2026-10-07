import { afterEach, describe, expect, it, vi } from 'vitest';
import { scopePhoneStorage } from './yelan-managed-client';

describe('managed phone account storage', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('isolates reads, enumeration, clearing and database names without double-prefixing on reinitialization', async () => {
    const rows = new Map([['yelan:other:secret', 'other'], ['legacy', 'old']]);
    const nativeStorage = {
      get length() { return rows.size; }, key: (i: number) => [...rows.keys()][i] ?? null,
      getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => rows.set(key, value),
      removeItem: (key: string) => rows.delete(key),
    };
    const open = vi.fn(), remove = vi.fn();
    vi.stubGlobal('window', { localStorage: nativeStorage });
    vi.stubGlobal('indexedDB', { open, deleteDatabase: remove, databases: async () => [{ name: 'yelan:owner:chat', version: 1 }, { name: 'yelan:other:chat', version: 1 }] });
    scopePhoneStorage('owner');
    window.localStorage.setItem('message', 'own');
    scopePhoneStorage('owner');
    expect(window.localStorage.getItem('message')).toBe('own');
    expect(window.localStorage.getItem('secret')).toBeNull();
    expect(window.localStorage.getItem('legacy')).toBeNull();
    expect(Object.keys(window.localStorage)).toEqual(['message']);
    indexedDB.open('chat', 1); indexedDB.deleteDatabase('chat');
    expect(open).toHaveBeenCalledWith('yelan:owner:chat', 1);
    expect(remove).toHaveBeenCalledWith('yelan:owner:chat');
    expect(await indexedDB.databases()).toEqual([{ name: 'chat', version: 1 }]);
    expect(() => scopePhoneStorage('other')).toThrow('重新进入');
    window.localStorage.clear();
    expect(rows.get('yelan:other:secret')).toBe('other');
    expect(rows.get('legacy')).toBe('old');
    expect(rows.has('yelan:owner:message')).toBe(false);
  });
});
