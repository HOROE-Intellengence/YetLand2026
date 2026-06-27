#!/usr/bin/env node
import { spawn } from 'node:child_process';
import net from 'node:net';

const MOCK_PORT = Number(process.env.MOCK_PORT || 8787);
const SERVER_PORT = Number(process.env.SERVER_PORT || 8789);
const MOCK_BASE = process.env.MOCK_SERVER_BASE || `http://127.0.0.1:${MOCK_PORT}`;

const children = [];
let startedApi = false;

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, ...options.env },
  });
  children.push(child);
  return child;
}

async function isApiReady() {
  try {
    const res = await fetch(`${MOCK_BASE}/health`, { signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

async function waitForApi() {
  for (let i = 0; i < 45; i += 1) {
    if (await isApiReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

async function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '127.0.0.1');
  });
}

function stopChildTree(child) {
  if (!child.pid) return;
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', shell: true });
  } else {
    child.kill('SIGTERM');
  }
}

function cleanup() {
  for (const child of children) {
    if (!child.killed) stopChildTree(child);
  }
}

process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});
process.on('SIGTERM', () => {
  cleanup();
  process.exit(143);
});

console.log('');
console.log('  linked server dev');
console.log(`  apps/api: ${MOCK_BASE}`);
console.log(`  apps/server: http://127.0.0.1:${SERVER_PORT}`);
console.log('');

if (!(await isPortAvailable(SERVER_PORT))) {
  console.error(`apps/server port ${SERVER_PORT} is already in use. Stop that process or set SERVER_PORT to a free port.`);
  process.exit(1);
}

if (!(await isApiReady())) {
  startedApi = true;
  console.log(`  starting apps/api on ${MOCK_BASE} ...`);
  run('pnpm', ['dev:mock'], {
    env: {
      DEPLOY_MODE: 'local',
      MOCK_PORT: String(MOCK_PORT),
    },
  });
  const ready = await waitForApi();
  if (!ready) {
    console.error(`apps/api did not become ready at ${MOCK_BASE}/health`);
    cleanup();
    process.exit(1);
  }
} else {
  console.log('  apps/api already running, reusing it.');
}

console.log('  starting apps/server with mock fallback enabled ...');
const server = run('pnpm', [
  '--filter',
  '@yelan/server',
  'exec',
  'wrangler',
  'dev',
  '--port',
  String(SERVER_PORT),
  '--local-protocol',
  'http',
  '--var',
  'ENABLE_MOCK_FALLBACK:true',
  '--var',
  `MOCK_SERVER_BASE:${MOCK_BASE}`,
]);

server.on('exit', (code) => {
  if (startedApi) cleanup();
  process.exit(code ?? 0);
});
