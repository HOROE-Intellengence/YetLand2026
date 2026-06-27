// Upstash Redis（HTTP API，Workers 友好）
// 用途: rate-limit 滑窗、cost 累计 today/{userId}、OTP TTL、KV 缓存
export interface Redis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number; nx?: boolean }): Promise<'OK' | null>;
  incr(key: string): Promise<number>;
  incrby(key: string, by: number): Promise<number>;
  expire(key: string, seconds: number): Promise<number>;
  del(key: string): Promise<number>;
}

export function createRedis(_url: string): Redis {
  // TODO: 用 fetch 调 Upstash REST
  return {
    async get() { return null; },
    async set() { return 'OK'; },
    async incr() { return 0; },
    async incrby() { return 0; },
    async expire() { return 0; },
    async del() { return 0; },
  };
}
