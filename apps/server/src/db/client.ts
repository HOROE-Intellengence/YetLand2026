// Postgres 客户端 — Workers 里推荐 Hyperdrive + postgres.js / Neon HTTP driver
// TODO: 选定后填充。本文件只暴露 query() / tx()
export interface Db {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
  tx<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

export function createDb(_url: string): Db {
  return {
    async query() { throw new Error('TODO: connect Postgres'); },
    async tx() { throw new Error('TODO'); },
  };
}
