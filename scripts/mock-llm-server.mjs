#!/usr/bin/env node
// ============================================================================
// 夜阑 · 本地仿真上游 LLM（mock-llm-server）
// ----------------------------------------------------------------------------
// 一个零依赖的假「模型服务商」，同时讲两种协议：
//   - OpenAI 兼容：POST /v1/chat/completions   （主路由 openai-compatible + 全部侧袋）
//   - Anthropic ：POST /v1/messages            （主路由 anthropic）
//
// 把各家 *_BASE_URL 指到本服务、API key 填任意 >10 位的假串，整个后端就能在
// 「完全离线 / 零额度 / 确定性可复现」的前提下跑通对话与侧袋全链路。
//
// 用法：
//   node scripts/mock-llm-server.mjs                  # 默认 127.0.0.1:8799
//   MOCK_LLM_PORT=9001 node scripts/mock-llm-server.mjs
//   （一般不用单独起，`pnpm sim` 会一并拉起，见 scripts/start-sim.mjs）
//
// 环境变量：
//   MOCK_LLM_HOST     默认 127.0.0.1
//   MOCK_LLM_PORT     默认 8799
//   MOCK_LLM_DELAY_MS 流式分片之间的间隔毫秒（默认 20；设 0 = 瞬时返回）
// ============================================================================
import { createServer } from 'node:http';

const HOST = process.env.MOCK_LLM_HOST || '127.0.0.1';
const PORT = Number(process.env.MOCK_LLM_PORT || 8799);
const DELAY_MS = Number(process.env.MOCK_LLM_DELAY_MS ?? 20);

const sleep = (ms) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/** 取最后一条 user 消息文本（兼容 string / 分块 content 数组）。 */
function lastUserText(messages = []) {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      return m.content.map((p) => (typeof p === 'string' ? p : (p?.text ?? ''))).join('');
    }
  }
  return '';
}

/**
 * 确定性回复：同样的输入永远得到同样的输出（无随机），方便复现 bug。
 * 刻意带「mock-llm」标记，让人一眼看出这不是真实模型应答。
 */
function buildReply(messages) {
  const user = lastUserText(messages).replace(/\s+/g, ' ').trim().slice(0, 80);
  return (
    `【mock-llm】我收到了你说的：「${user || '(空消息)'}」。` +
    `这是本地仿真上游返回的确定性应答，没有调用真实模型，也没有消耗任何额度。`
  );
}

/** 按 Unicode 码点切片，避免切坏中文/emoji，用来模拟逐字流式。 */
function chunkText(text, size = 6) {
  const chars = Array.from(text);
  const out = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(''));
  return out;
}

function setCors(res) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  res.setHeader('access-control-allow-methods', '*');
}

// ── OpenAI 兼容：/v1/chat/completions ───────────────────────────────────────
async function handleOpenAIChat(res, body) {
  const model = body.model || 'mock-model';
  const wantsJson = body?.response_format?.type === 'json_object';

  // 侧袋任务走 response_format=json_object：返回合法空对象。
  // 各侧袋消费方要么 zod 校验失败优雅降级、要么 normalize 兜底，空对象不会致崩。
  if (wantsJson) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'mock-' + Date.now(),
        object: 'chat.completion',
        model,
        choices: [{ index: 0, message: { role: 'assistant', content: '{}' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      }),
    );
    return;
  }

  const reply = buildReply(body.messages);

  if (body.stream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    for (const piece of chunkText(reply)) {
      if (closed) return;
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: piece } }] })}\n\n`);
      await sleep(DELAY_MS);
    }
    if (!closed) {
      res.write('data: [DONE]\n\n');
      res.end();
    }
    return;
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'mock-' + Date.now(),
      object: 'chat.completion',
      model,
      choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: Array.from(reply).length, total_tokens: 0 },
    }),
  );
}

// ── Anthropic：/v1/messages ─────────────────────────────────────────────────
async function handleAnthropicMessages(res, body) {
  const model = body.model || 'mock-claude';
  const reply = buildReply(body.messages);

  if (body.stream) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    });
    let closed = false;
    res.on('close', () => {
      closed = true;
    });
    res.write(`data: ${JSON.stringify({ type: 'message_start', message: { model } })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'content_block_start', index: 0 })}\n\n`);
    for (const piece of chunkText(reply)) {
      if (closed) return;
      res.write(
        `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } })}\n\n`,
      );
      await sleep(DELAY_MS);
    }
    if (!closed) {
      res.write(`data: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'message_stop' })}\n\n`);
      res.end();
    }
    return;
  }

  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(
    JSON.stringify({
      id: 'mock-' + Date.now(),
      type: 'message',
      role: 'assistant',
      model,
      content: [{ type: 'text', text: reply }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: Array.from(reply).length },
    }),
  );
}

const server = createServer(async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = (req.url || '').split('?')[0];

  if (req.method === 'GET' && (url === '/health' || url === '/')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'mock-llm', host: HOST, port: PORT }));
    return;
  }

  try {
    if (req.method === 'POST' && url === '/v1/chat/completions') {
      return await handleOpenAIChat(res, await readBody(req));
    }
    if (req.method === 'POST' && url === '/v1/messages') {
      return await handleAnthropicMessages(res, await readBody(req));
    }
  } catch (e) {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'mock-llm error', message: String(e?.message ?? e) }));
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'mock-llm: not found', path: url }));
});

server.listen(PORT, HOST, () => {
  console.log(`  🤖 mock-llm 仿真上游已就绪 → http://${HOST}:${PORT}`);
  console.log('     OpenAI 兼容: POST /v1/chat/completions    Anthropic: POST /v1/messages');
});
