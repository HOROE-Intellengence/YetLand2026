let token = '';
export const isYelanManaged = process.env.NEXT_PUBLIC_YELAN_PHONE_MANAGED === 'true';
export function setYelanToken(value: string) { token = value; }
export function yelanHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
}
export async function yelanRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/host${path}`, { ...init, headers: { ...yelanHeaders(), ...init?.headers } });
  if (!response.ok) throw new Error(response.status === 401 ? '请返回夜阑重新登录' : '夜阑服务暂不可用');
  const data = await response.json();
  const streamedStatus = response.headers.get('X-Yelan-Streaming-JSON') === '1' ? data?.__yelan_http_status : undefined;
  if (typeof streamedStatus === 'number' && (streamedStatus < 200 || streamedStatus >= 300)) {
    throw new Error(streamedStatus === 401 ? '请返回夜阑重新登录' : '夜阑服务暂不可用');
  }
  return data;
}

// Installed before importing the phone application. Keep its existing local
// persistence while separating accounts; no cross-device synchronization.
export function scopePhoneStorage(userId: string) {
  const marker = Symbol.for('yelan.phone.storage-user');
  const scopeState = window as unknown as Record<symbol, string | undefined>;
  if (scopeState[marker] === userId) return;
  if (scopeState[marker]) throw new Error('切换账号后请重新进入小手机');
  const prefix = `yelan:${encodeURIComponent(userId)}:`;
  const original = window.localStorage;
  const keys = () => Array.from({ length: original.length }, (_, i) => original.key(i)!)
    .filter(key => key.startsWith(prefix));
  const storage = {
    get length() { return keys().length; },
    key(i: number) { return keys()[i]?.slice(prefix.length) ?? null; },
    getItem(key: string) { return original.getItem(prefix + key); },
    setItem(key: string, value: string) { original.setItem(prefix + key, value); },
    removeItem(key: string) { original.removeItem(prefix + key); },
    clear() { keys().forEach(key => original.removeItem(key)); },
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: new Proxy(storage, {
    get(target, key) { return key in target ? Reflect.get(target, key) : storage.getItem(String(key)); },
    set(_target, key, value) { storage.setItem(String(key), String(value)); return true; },
    ownKeys() { return keys().map(key => key.slice(prefix.length)); },
    getOwnPropertyDescriptor() { return { configurable: true, enumerable: true }; },
  }) });
  const open = indexedDB.open.bind(indexedDB);
  const remove = indexedDB.deleteDatabase.bind(indexedDB);
  indexedDB.open = (name: string, version?: number) => version === undefined ? open(prefix + name) : open(prefix + name, version);
  indexedDB.deleteDatabase = (name: string) => remove(prefix + name);
  if (indexedDB.databases) {
    const databases = indexedDB.databases.bind(indexedDB);
    indexedDB.databases = async () => (await databases()).filter(db => db.name?.startsWith(prefix))
      .map(db => ({ ...db, name: db.name!.slice(prefix.length) }));
  }
  scopeState[marker] = userId;
}
