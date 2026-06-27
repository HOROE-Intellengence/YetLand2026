// 启动前先加载根目录 .env（不引入 dotenv 依赖：手写 KEY=VALUE 解析，覆盖空值）
// 顺序：apps/api/.env > 根目录 .env（两者都可选）
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// apps/api/src → apps/api
const APP_DIR = resolve(here, '..');
// → 根
const ROOT_DIR = resolve(here, '..', '..', '..');

function loadFile(path: string): void {
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined || process.env[key] === '') {
      process.env[key] = val;
    }
  }
}

// 优先 app 自己的 .env，其次根 .env
loadFile(resolve(APP_DIR, '.env'));
loadFile(resolve(ROOT_DIR, '.env'));
