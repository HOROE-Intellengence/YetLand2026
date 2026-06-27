#!/usr/bin/env node
// ============================================================================
// 夜阑 · 一键本地仿真环境（sim）
// ----------------------------------------------------------------------------
// 做三件事：
//   1. 拉起 mock-llm 仿真上游（scripts/mock-llm-server.mjs）
//   2. 用「假 key + 指向 mock 的 baseUrl」覆盖所有 LLM provider 环境变量
//   3. 用隔离目录 YELAN_STATE_DIR=apps/api/.local-sim 起 `pnpm dev`（api + web 并行）
//
// 结果：完全离线、零额度、确定性可复现的全栈环境，且绝不碰你真实的
// apps/api/.local/state.json。
//
// 为什么要给每家都塞假 key？
//   apps/api 的 LLM 清单首次启动时会从环境变量「现场播种」进 state.json，主模型按
//   Anthropic > OpenAI > DeepSeek > NVIDIA 取第一个有 key 的。我们把每家 key 都设成
//   假串、baseUrl 都指向 mock —— 这样无论种子选中谁，请求都落到仿真上游；同时非空值
//   还能压住根 .env 里可能存在的真实 key（bootstrap-env 只填空缺，不覆盖已设值）。
//
// 用法：
//   pnpm sim            # = node scripts/start-sim.mjs
//   Ctrl-C 一并退出 mock-llm 与 dev。
// ============================================================================
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..');

const MOCK_HOST = process.env.MOCK_LLM_HOST || '127.0.0.1';
const MOCK_PORT = process.env.MOCK_LLM_PORT || '8799';
const MOCK_OPENAI_BASE = `http://${MOCK_HOST}:${MOCK_PORT}/v1`; // openai / deepseek 兼容层
const MOCK_ANTHROPIC_BASE = `http://${MOCK_HOST}:${MOCK_PORT}`; // anthropic 自己拼 /v1/messages
const FAKE_KEY = 'sk-mock-local-0000000000000000'; // 任意 >10 位即被视为「就绪」

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* ignore */
    }
  }
  process.exit(code);
}

function spawnChild(cmd, args, env, label) {
  const child = spawn(cmd, args, { cwd: ROOT, env, stdio: 'inherit', shell: true });
  child.on('exit', (code) => {
    console.log(`  [${label}] 退出 (code=${code})`);
    shutdown(code ?? 0);
  });
  child.on('error', (e) => {
    console.error(`  [${label}] 启动失败:`, e.message);
    shutdown(1);
  });
  children.push(child);
  return child;
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// 1) 仿真上游
spawnChild(
  'node',
  ['scripts/mock-llm-server.mjs'],
  { ...process.env, MOCK_LLM_HOST: MOCK_HOST, MOCK_LLM_PORT: MOCK_PORT },
  'mock-llm',
);

// 2) api + web（注入仿真 env）
const simEnv = {
  ...process.env,
  DEPLOY_MODE: 'local',
  // 隔离状态库：种子会按下面这套 mock env 现场播种，绝不动真实 .local
  YELAN_STATE_DIR: resolve(ROOT, 'apps/api/.local-sim'),
  // 主路由 + 侧袋：每家给假 key、baseUrl 指向 mock
  ANTHROPIC_API_KEY: FAKE_KEY,
  ANTHROPIC_BASE_URL: MOCK_ANTHROPIC_BASE,
  OPENAI_API_KEY: FAKE_KEY,
  OPENAI_BASE_URL: MOCK_OPENAI_BASE,
  DEEPSEEK_API_KEY: FAKE_KEY,
  DEEPSEEK_BASE_URL: MOCK_OPENAI_BASE,
  SIDECAR_API_KEY: FAKE_KEY,
  SIDECAR_BASE_URL: MOCK_OPENAI_BASE,
  SIDECAR_TASK_API_KEY: FAKE_KEY,
  SIDECAR_TASK_BASE_URL: MOCK_OPENAI_BASE,
};

console.log('');
console.log('  🧪 夜阑本地仿真环境 (sim)');
console.log(`     mock-llm  : http://${MOCK_HOST}:${MOCK_PORT}`);
console.log('     state dir : apps/api/.local-sim（隔离，不碰真实数据）');
console.log('     启动 api + web …');
console.log('');

spawnChild('pnpm', ['dev'], simEnv, 'dev');
