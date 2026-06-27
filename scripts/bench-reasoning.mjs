// 主 AI reasoning_effort A/B 基准 — minimal vs low（参照 bench-structurer-horoe.mjs）。
//
// 目的：在真实主 AI 端点（gemini-3.1-flash-lite @ horoe.cn/v1）上对比两档推理：
//   - minimal：flash-lite 默认档（不传 reasoning_effort ≈ 此档；这里显式发 'minimal' 以对齐）
//   - low    ：项目准备切换的新默认档
// 指标：TTFT / 总延时 / think 泄漏率（对原始 content 检测 <think>，与线上 think-sanitizer 同口径）
//        / completion tokens / finish_reason；并预留人工质量打分列 qualityScore（默认 null）。
// 输出：scripts/.bench-reasoning-<timestamp>.json
//
// 安全：apiKey 只从 state.json / 快照读入内存用于请求头，绝不打印 / 入库。
// 用法：node scripts/bench-reasoning.mjs [--rounds=3] [--efforts=minimal,low] [--out=scripts/.bench-reasoning.json]

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const argVal = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const ROUNDS = Number(argVal('rounds')) || 3;
const EFFORTS = argVal('efforts') ? argVal('efforts').split(',').map((s) => s.trim()) : ['minimal', 'low'];
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const OUT_FILE = argVal('out') || `scripts/.bench-reasoning-${ts}.json`;

const CALL_TIMEOUT_MS = 45000;
const PACING_MS = 2500;       // 每发间隔，避开 horoe.cn 限流
const ERROR_COOLDOWN_MS = 10000;
const MAX_NET_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 1) 解析真实端点：state.json(main→sidecar) → 最新含 key 的快照 ──────────────
function pickEntry(inv) {
  if (!inv) return null;
  const byId = (id) => (id && inv.entries?.[id]?.apiKey?.length > 10 ? inv.entries[id] : null);
  return byId(inv.mainApiId)
    || byId(inv.sidecarApiId)
    || Object.values(inv.entries || {}).find((e) => e.protocol === 'openai-compatible' && e.apiKey?.length > 10)
    || null;
}

function resolveEndpoint() {
  if (process.env.YELAN_STATE_FILE) {
    const s = JSON.parse(readFileSync(resolve(process.env.YELAN_STATE_FILE), 'utf8'));
    const e = pickEntry(s.llmApiInventory);
    if (e) return { entry: e, source: 'YELAN_STATE_FILE' };
  }
  const localDir = resolve(repoRoot, 'apps', 'api', '.local');
  const stateFile = join(localDir, 'state.json');
  if (existsSync(stateFile)) {
    const e = pickEntry(JSON.parse(readFileSync(stateFile, 'utf8')).llmApiInventory);
    if (e) return { entry: e, source: 'state.json' };
  }
  // 回退：扫快照，挑最新一个含 key 的条目
  const snapDir = join(localDir, 'snapshots');
  if (existsSync(snapDir)) {
    const snaps = readdirSync(snapDir).filter((f) => f.startsWith('snapshot-') && f.endsWith('.json')).sort().reverse();
    for (const f of snaps) {
      try {
        const e = pickEntry(JSON.parse(readFileSync(join(snapDir, f), 'utf8')).llmApiInventory);
        if (e) return { entry: e, source: `snapshots/${f}` };
      } catch { /* 跳过损坏快照 */ }
    }
  }
  return null;
}

const resolved = resolveEndpoint();
if (!resolved) {
  console.error('✗ 找不到含有效 apiKey 的主/侧袋条目（state.json 与快照都没有）。');
  console.error('  请在后台配置主 AI，或设置 YELAN_STATE_FILE 指向含条目的 state.json。');
  process.exit(1);
}
const { entry, source } = resolved;
const BASE_URL = String(entry.baseUrl).replace(/\/+$/, '');
const MODEL = entry.model;
const API_KEY = entry.apiKey;
const mask = (v) => (v.length <= 10 ? '****' : `${v.slice(0, 4)}...${v.slice(-4)}`);

// ── 2) 代表性主 AI 输入（固定 system + 几条用户轮）──────────────────────────────
// 主 prompt 装配复杂，bench 用一份紧凑但同风格的角色扮演 system，保证两档之间唯一变量是 reasoning_effort。
const SYSTEM_PROMPT =
  '你是沉浸式中文角色扮演里的男主角「沈砚」——克制、疏离、话不多，但每句都有分量。\n' +
  '规则：\n' +
  '- 用第二人称称呼对方为「你」。\n' +
  '- 对白、动作(写在中文括号里)、环境、心理可混合，但保持自然口语，不要长篇大论。\n' +
  '- 严禁输出任何思考过程、<think> 标签、解释或元叙述，直接给出角色的回应。\n' +
  '- 回应控制在 4 句以内。';

const INPUTS = [
  { key: 'greet', text: '（推门进来，抖落肩上的雪）我来晚了。' },
  { key: 'probe', text: '你今天……好像有心事。是发生什么了吗？' },
  { key: 'cipher', text: '我记得你说过，如果有一天我念出那句暗号，你就会告诉我真相。「夜阑听雨」。' },
];

// ── 3) think 泄漏度量（与 think-sanitizer 同口径：检测 <think> 区段）──────────────
function thinkMetrics(raw) {
  const lower = raw.toLowerCase();
  const open = lower.indexOf('<think>');
  const close = lower.indexOf('</think>');
  const enteredThink = open >= 0 || close >= 0;
  const endedInsideThink = open >= 0 && close < 0;
  let leakedChars = 0;
  if (open >= 0) {
    leakedChars = (close >= 0 ? close : raw.length) - (open + '<think>'.length);
    if (leakedChars < 0) leakedChars = 0;
  } else if (close >= 0) {
    // 只有闭标签（开标签在更早的 chunk 被吞或模型省略开标签）：闭标签前全算泄漏
    leakedChars = close;
  }
  return { enteredThink, endedInsideThink, leakedChars };
}

// ── 4) 流式单发 ──────────────────────────────────────────────────────────────
async function streamCall(system, user, effort) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  const t0 = Date.now();
  let ttft = null;
  let content = '';
  let completionTokens = null;
  let finishReason = null;
  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}`, Connection: 'close' },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.8,
        max_tokens: 1024,
        reasoning_effort: effort,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { error: `HTTP ${res.status}: ${txt.slice(0, 160)}`, httpStatus: res.status, elapsed: Date.now() - t0 };
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop() ?? '';
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith('data:')) continue;
        const data = l.slice(5).trim();
        if (data === '[DONE]') continue;
        let j;
        try { j = JSON.parse(data); } catch { continue; }
        const delta = j.choices?.[0]?.delta?.content;
        if (delta) {
          if (ttft === null) ttft = Date.now() - t0;
          content += delta;
        }
        if (j.choices?.[0]?.finish_reason) finishReason = j.choices[0].finish_reason;
        if (j.usage?.completion_tokens != null) completionTokens = j.usage.completion_tokens;
      }
    }
    const total = Date.now() - t0;
    return { total, ttft: ttft ?? total, decode: total - (ttft ?? total), content, completionTokens, finishReason };
  } catch (e) {
    return { error: e.name === 'AbortError' ? `timeout ${CALL_TIMEOUT_MS}ms` : String(e.message), elapsed: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

async function callWithRetry(system, user, effort) {
  let netRetries = 0;
  for (;;) {
    const r = await streamCall(system, user, effort);
    if (!r.error) return { ...r, netRetries };
    if (/timeout/.test(r.error) || /^HTTP /.test(r.error)) return { ...r, netRetries }; // 真实超时/HTTP 错误不重试
    if (netRetries >= MAX_NET_RETRIES) return { ...r, netRetries, exhausted: true };
    netRetries++;
    await sleep(ERROR_COOLDOWN_MS * netRetries);
  }
}

// ── 5) 统计 ──────────────────────────────────────────────────────────────────
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function pct(nums, p) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))];
}

async function run() {
  console.log('# 主 AI reasoning_effort A/B 基准');
  console.log(`endpoint = ${BASE_URL}  model = ${MODEL}  key = ${mask(API_KEY)}  (来源: ${source})`);
  console.log(`档位 = [${EFFORTS.join(', ')}]  inputs = ${INPUTS.length}  rounds/组 = ${ROUNDS}  单发上限 = ${CALL_TIMEOUT_MS}ms\n`);

  const all = [];
  for (const effort of EFFORTS) {
    for (const input of INPUTS) {
      const group = `${effort}×${input.key}`;
      console.log(`\n=== ${group} ===`);
      await sleep(PACING_MS);
      process.stdout.write('  warmup... ');
      const w = await callWithRetry(SYSTEM_PROMPT, input.text, effort);
      console.log(w.error ? `(err: ${w.error})` : `(${w.total}ms, finish=${w.finishReason})`);
      if (w.error) await sleep(ERROR_COOLDOWN_MS);

      for (let i = 0; i < ROUNDS; i++) {
        await sleep(PACING_MS);
        const r = await callWithRetry(SYSTEM_PROMPT, input.text, effort);
        const tm = r.error ? { enteredThink: null, endedInsideThink: null, leakedChars: null } : thinkMetrics(r.content);
        const row = {
          group, effort, input: input.key,
          total: r.total ?? null, ttft: r.ttft ?? null, decode: r.decode ?? null,
          completionTokens: r.completionTokens ?? null, finishReason: r.finishReason ?? null,
          enteredThink: tm.enteredThink, endedInsideThink: tm.endedInsideThink, leakedChars: tm.leakedChars,
          outChars: r.content?.length ?? null,
          error: r.error ?? null,
          httpStatus: r.httpStatus ?? null,
          qualityScore: null, // 预留人工质量打分（1-5），跑完后人工回填
        };
        all.push(row);
        console.log(
          `  ${String(i + 1).padStart(2)}: ` +
          (r.error
            ? `ERROR ${r.error}`
            : `total=${String(r.total).padStart(5)}ms ttft=${String(r.ttft).padStart(5)}ms ` +
              `outTok=${String(r.completionTokens ?? '?').padStart(4)} finish=${(r.finishReason ?? '?').padEnd(6)} ` +
              `think=${tm.enteredThink ? `泄漏${tm.leakedChars}字${tm.endedInsideThink ? '(未闭合)' : ''}` : '无'}`),
        );
        if (r.error) await sleep(ERROR_COOLDOWN_MS);
      }
    }
  }

  // ── 汇总（按档位聚合）──
  console.log('\n\n========== 汇总（按档位）==========');
  console.log(['档位', 'n', 'err', 'think泄漏率', 't.P50', 't.P90', 'ttft.P50', 'outTok中位'].join('\t'));
  const summary = [];
  for (const effort of EFFORTS) {
    const rows = all.filter((r) => r.effort === effort);
    const okRows = rows.filter((r) => !r.error);
    const totals = okRows.map((r) => r.total);
    const leaked = okRows.filter((r) => r.enteredThink).length;
    const rec = {
      effort,
      n: rows.length,
      errors: rows.filter((r) => r.error).length,
      thinkLeakRate: okRows.length ? `${leaked}/${okRows.length}` : '0/0',
      total_p50: median(totals), total_p90: pct(totals, 90),
      ttft_p50: median(okRows.map((r) => r.ttft)),
      outTok_median: median(okRows.map((r) => r.completionTokens).filter((x) => x != null)),
    };
    summary.push(rec);
    console.log([rec.effort, rec.n, rec.errors, rec.thinkLeakRate, rec.total_p50, rec.total_p90, rec.ttft_p50, rec.outTok_median].join('\t'));
  }

  const out = {
    meta: { endpoint: BASE_URL, model: MODEL, source, efforts: EFFORTS, rounds: ROUNDS, runAt: new Date().toISOString(), inputs: INPUTS.map((i) => i.key) },
    summary,
    rows: all,
  };
  const outFile = resolve(repoRoot, OUT_FILE);
  writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n原始结果已写入: ${outFile}`);
  console.log('提示：qualityScore 列已预留为 null，人工对比两档输出质量后回填 1-5 分。');
}

run().catch((e) => { console.error(e); process.exit(1); });
