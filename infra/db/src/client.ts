// Postgres 连接 — 用 porsager/postgres，性能好、API 干净
import postgres from 'postgres';

export type Sql = ReturnType<typeof postgres>;

export function createSql(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('错误：环境变量 DATABASE_URL 未设置');
    console.error('请在项目根目录的 .env 文件里填: DATABASE_URL=postgres://user:pass@host/dbname');
    process.exit(1);
  }
  return postgres(url, { max: 5, onnotice: () => {} });
}

export function maskUrl(url: string): string {
  // 把密码遮成 ****，方便在 GUI 上显示当前连的是哪
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
}
