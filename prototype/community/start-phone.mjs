import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';

const root = resolve(import.meta.dirname, '../..');
const local = resolve(root, '.local/community-prototype');
const phone = resolve(root, 'ai-virtual-phone');
async function health() {
  try {
    const r = await fetch('http://localhost:3041/api/community-prototype-health', {
      signal: AbortSignal.timeout(2000),
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
if ((await health())?.prototype === 'yelan-community') {
  console.log('本地小手机已运行：http://localhost:3041');
} else {
  const occupied = await new Promise((r) => {
    const s = createConnection({ host: '127.0.0.1', port: 3041 });
    s.once('connect', () => {
      s.destroy();
      r(true);
    });
    s.once('error', () => r(false));
  });
  if (occupied)
    throw new Error('3041已被占用，但未返回本原型健康状态；请检查原进程，避免重复启动。');
  mkdirSync(local, { recursive: true });
  mkdirSync(resolve(phone, '.next'), { recursive: true });
  writeFileSync(
    resolve(phone, '.next/community-tsconfig.json'),
    JSON.stringify(
      {
        extends: '../tsconfig.json',
        compilerOptions: { incremental: false, baseUrl: '..' },
        include: ['../**/*.ts', '../**/*.tsx', '../next-env.d.ts'],
        exclude: ['../node_modules', '../supabase/functions'],
      },
      null,
      2,
    ),
  );
  const log = openSync(resolve(local, 'phone.log'), 'a');
  const child = spawn(
    process.execPath,
    ['scripts/local-next-server.mjs', '--dev', '--host', '127.0.0.1', '--port', '3041'],
    {
      cwd: phone,
      detached: true,
      windowsHide: true,
      stdio: ['ignore', log, log],
      env: {
        ...process.env,
        YELAN_COMMUNITY_PROTOTYPE: 'true',
        YELAN_PHONE_MANAGED: 'true',
        NEXT_PUBLIC_YELAN_PHONE_MANAGED: 'true',
        NEXT_PUBLIC_SELF_HOSTED_MODE: 'true',
        YELAN_API_ORIGIN: 'http://127.0.0.1:3038',
        NEXT_PUBLIC_YELAN_WEB_ORIGIN: 'http://localhost:3038',
        NEXT_DIST_DIR: '.next/community-prototype-v1',
        YELAN_PHONE_TSCONFIG: '.next/community-tsconfig.json',
        NEXT_TELEMETRY_DISABLED: '1',
        NO_PROXY: 'localhost,127.0.0.1',
        no_proxy: 'localhost,127.0.0.1',
      },
    },
  );
  child.on('error', (e) => console.error(e.message));
  child.unref();
  closeSync(log);
  writeFileSync(
    resolve(local, 'phone-process.json'),
    JSON.stringify({ pid: child.pid, port: 3041 }),
  );
  const deadline = Date.now() + 60000;
  let ready = false;
  while (Date.now() < deadline) {
    if ((await health())?.prototype === 'yelan-community') {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (ready) console.log('本地小手机：http://localhost:3041（从社区侧栏进入）');
  else {
    console.error('小手机尚未就绪，请查看.local/community-prototype/phone.log');
    process.exitCode = 1;
  }
}
