// 密码哈希 — Node 内置 crypto.scrypt，零外部依赖
// 序列化格式: scrypt:N=16384,r=8,p=1:salt(hex):hash(hex)
// 选 N=16384 (2^14)：约 50ms/次，足够防离线爆破又不会让登录卡顿
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const N = 16384;
const r = 8;
const p = 1;
const KEY_LEN = 64;
const SALT_LEN = 16;
const PREFIX = `scrypt:N=${N},r=${r},p=${p}`;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LEN, { N, r, p }, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(derivedKey);
    });
  });
}

/** 计算密码哈希。返回 `scrypt:N=…,r=…,p=…:saltHex:hashHex` 字符串。 */
export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const hash = await scryptAsync(plain, salt);
  return `${PREFIX}:${salt.toString('hex')}:${hash.toString('hex')}`;
}

/** 验证密码；旧格式或参数不匹配返回 false（强制升级路径在 Phase 4 backlog）。 */
export async function verifyPassword(plain: string, encoded: string): Promise<boolean> {
  const parts = encoded.split(':');
  if (parts.length !== 4) return false;
  const [scheme, params, saltHex, hashHex] = parts;
  if (scheme !== 'scrypt') return false;
  if (params !== `N=${N},r=${r},p=${p}`) return false; // 升级路径预留
  try {
    const salt = Buffer.from(saltHex!, 'hex');
    const expected = Buffer.from(hashHex!, 'hex');
    const actual = await scryptAsync(plain, salt);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

/** 密码强度校验：≥8 字符，至少含一个字母 + 一个数字。不强求特殊符号（UX 优先）。 */
export function isStrongPassword(plain: string): boolean {
  if (typeof plain !== 'string') return false;
  if (plain.length < 8 || plain.length > 128) return false;
  if (!/[A-Za-z]/.test(plain)) return false;
  if (!/[0-9]/.test(plain)) return false;
  return true;
}
