// CLI 入口 — 给习惯命令行的人用；GUI 只是另一种触发方式，底层共用 runner.ts
import { createSql, maskUrl } from './client';
import { status, up, newMigration, reset } from './runner';

const cmd = process.argv[2];
const arg = process.argv[3];

async function main() {
  switch (cmd) {
    case 'status': {
      const sql = createSql();
      console.log(`DB: ${maskUrl(process.env.DATABASE_URL!)}`);
      const rows = await status(sql);
      console.log(`迁移总数: ${rows.length}  已应用: ${rows.filter((r) => r.applied).length}`);
      for (const r of rows) {
        const mark = r.applied ? '✓' : '·';
        const at = r.appliedAt ? `  (${r.appliedAt})` : '';
        console.log(`  ${mark} ${r.id}${at}`);
      }
      await sql.end();
      break;
    }
    case 'up': {
      const sql = createSql();
      console.log(`DB: ${maskUrl(process.env.DATABASE_URL!)}`);
      const applied = await up(sql, { onProgress: (id) => console.log(`✓ ${id}`) });
      if (applied.length === 0) console.log('已是最新，没有 pending 迁移。');
      await sql.end();
      break;
    }
    case 'new': {
      if (!arg) {
        console.error('用法: pnpm db:new <name>  例: pnpm db:new add_user_nickname');
        process.exit(1);
      }
      const { path, id } = newMigration(arg);
      console.log(`✓ 已创建 ${id}`);
      console.log(`  路径: ${path}`);
      console.log('  打开后在 BEGIN; ... COMMIT; 之间写 SQL，然后跑 pnpm db:up');
      break;
    }
    case 'reset': {
      const sql = createSql();
      console.log(`DB: ${maskUrl(process.env.DATABASE_URL!)}  ⚠ 即将 DROP SCHEMA public CASCADE`);
      const { applied } = await reset(sql);
      console.log(`✓ 重置完成，重新应用了 ${applied.length} 个迁移`);
      await sql.end();
      break;
    }
    default:
      console.log(`用法:
  pnpm db:status         查看哪些迁移已应用 / pending
  pnpm db:up             应用所有 pending 迁移
  pnpm db:new <name>     生成新迁移文件
  pnpm db:reset          危险：清空 schema 后重跑全部（需 MIGRATE_ALLOW_DESTRUCTIVE=true）
  pnpm db:gui            打开浏览器图形界面`);
      process.exit(cmd ? 1 : 0);
  }
}

main().catch((e) => {
  console.error('错误:', e instanceof Error ? e.message : e);
  process.exit(1);
});
