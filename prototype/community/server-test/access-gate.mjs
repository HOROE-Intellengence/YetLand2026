import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createHmac, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const config = JSON.parse(readFileSync(process.env.COMMUNITY_GATE_CONFIG, 'utf8'));
const origin = new URL(config.origin);
const hosts = new Set(config.hosts);
const cookieName = 'yl_community_access';
const lifetime = 12 * 60 * 60;
const attempts = new Map();
const sign = value => createHmac('sha256', config.sessionSecret).update(value).digest('hex');
function equal(a, b) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
function authorized(cookie = '') {
  const value = cookie.split(';').map(s => s.trim()).find(s => s.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
  if (!value || value.length > 120) return false;
  const [expires, signature] = value.split('.');
  const now = Math.floor(Date.now() / 1000);
  return /^\d+$/.test(expires) && Number(expires) > now && Number(expires) <= now + lifetime && equal(signature || '', sign(expires));
}
const cookie = value => `${cookieName}=${value}; Domain=${origin.hostname}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${value ? lifetime : 0}`;
const page = error => `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>夜阑社区 · 内部测试</title><style>body{margin:0;background:#11131a;color:#e8e1d5;font:16px/1.7 system-ui;display:grid;min-height:100dvh;place-items:center}main{width:min(360px,calc(100% - 64px));padding:32px;border:1px solid #494236;border-radius:12px}h1{font-size:26px;font-weight:500}p{color:#b6b1a7}label{display:block;margin:20px 0 8px}input,button{box-sizing:border-box;width:100%;font:inherit;border-radius:6px;padding:12px}input{background:#20232c;color:#fff;border:1px solid #797366}button{margin-top:18px;border:0;background:#c8a878;color:#111;cursor:pointer}.error{color:#f3a7a7}a{color:#c8a878}</style><main><h1>夜阑社区</h1><p>当前为内部测试，请输入访问密码。</p>${error ? '<p class="error" role="alert">密码不正确或尝试过于频繁，请稍后重试。</p>' : ''}<form method="post" action="/__community-access"><label for="password">访问密码</label><input id="password" name="password" type="password" autocomplete="current-password" required maxlength="128"><button type="submit">进入社区</button></form><p><a href="https://yetland.cn/">返回夜阑</a></p></main></html>`;

const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(':')[0];
  if (!hosts.has(host)) { res.writeHead(404).end(); return; }
  const pathname = new URL(req.url, 'http://gate.internal').pathname;
  if (pathname === '/check') {
    if (authorized(req.headers.cookie)) { res.writeHead(204).end(); return; }
    const path = String(req.headers['x-forwarded-uri'] || '/');
    if (path.startsWith('/api/') || path.startsWith('/socket.io/')) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"message":"请先输入社区测试密码"}');
    } else res.writeHead(303, { Location: `${origin.origin}/__community-access` }).end();
    return;
  }
  if (host !== origin.hostname || pathname !== '/__community-access') { res.writeHead(404).end(); return; }
  if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(false)); return; }
  if (req.method !== 'POST' || req.headers.origin !== origin.origin) { res.writeHead(403).end(); return; }
  const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
  const attempt = attempts.get(ip) || { count: 0, until: now + 600000 };
  if (attempts.size >= 10000 || ++attempt.count > 10) { res.writeHead(429, { 'Content-Type': 'text/html; charset=utf-8', 'Retry-After': '600' }).end(page(true)); return; }
  attempts.set(ip, attempt);
  try {
    let body = '';
    for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 8192) { res.writeHead(413).end(); return; } }
    const password = new URLSearchParams(body).get('password') || '';
    const derived = await scrypt(password, config.passwordSalt, 64);
    if (password.length > 128 || !equal(derived.toString('hex'), config.passwordHash)) {
      res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' }).end(page(true)); return;
    }
    attempts.delete(ip);
    const expires = String(Math.floor(Date.now() / 1000) + lifetime);
    res.writeHead(303, { Location: origin.origin + '/', 'Set-Cookie': cookie(`${expires}.${sign(expires)}`) }).end();
  } catch { res.writeHead(400).end(); }
});
server.listen(Number(process.env.PORT || 3042), '0.0.0.0', () => console.log('Community access gate ready'));
