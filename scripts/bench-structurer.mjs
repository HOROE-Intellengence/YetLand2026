// 分句侧袋延时基准 — 三方案各 5 轮，流式分离 TTFT / decode，只统计解析完整的轮次。
// 端点：NVIDIA NIM（OpenAI 兼容），模型 z-ai/glm-5.1（项目默认）。
import fs from 'node:fs';

const KEY = fs.readFileSync('.env', 'utf8').match(/NVIDIA_API_KEY=(\S+)/)[1];
const URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODEL = 'z-ai/glm-5.1';
const ROUNDS = 5;
const CALL_TIMEOUT_MS = 90000;

// 截图里那条真实多句回复（对白 / 动作(括号) / 旁白混合）
const SAMPLE =
  '是。上次见，还是那场学术沙龙。（他侧身，把刚沏好的茶杯推到你手边，杯沿的温度刚好。）' +
  '这里比那时安静些。坐。没忘。只是觉得，没必要说那么多废话。' +
  '（他放下手中正在勾勒图纸的铅笔，转过头，视线越过镜框边缘落在你脸上。）' +
  '不想见，就不会把门锁的密码留给你。' +
  '（他转过身，背靠着书架，目光在你身上停留了三秒，语气平淡。）别多想。';

// 服务端确定性切句（与 fallbackStructure 同一套规则）
function splitSentences(text) {
  return text.split(/(?<=[。！？…!?]["」』）)]?\s*)/).map((s) => s.trim()).filter(Boolean);
}

const VALID = new Set(['dialogue', 'action', 'environment', 'narration']);
const CODE2TYPE = { d: 'dialogue', a: 'action', e: 'environment', n: 'narration' };

// ── 三方案定义：{ system, user, parse(content) -> {ok, parts} } ──────────────
const PROMPT_A = `你是一个文本结构分析助手。你的任务是将一段叙事文本拆分为结构化的消息片段。

根据文本内容，将每个句子或段落分类为以下类型，输出 JSON 对象，
所有片段放在 "parts" 数组里：
{
  "parts": [
    { "type": "dialogue", "text": "角色说的台词" },
    { "type": "action", "text": "动作描写" },
    { "type": "environment", "text": "环境/背景描写" },
    { "type": "narration", "text": "心理/旁白" }
  ]
}

规则：
- type 只能是 "dialogue"、"action"、"environment"、"narration" 之一
- dialogue：角色的直接引语或对话
- action：动作描写、身体语言
- environment：场景、环境、氛围描写
- narration：叙述者的心理描写、旁白、内心独白
- 保持原文不变，只做拆分和分类
- 思考过程 / <think> 标签内的内容直接丢弃，不要纳入任何 part
- 只输出 JSON 对象，不要有任何其他文字`;

const PROMPT_B = `将叙事文本按句拆分并分类。只输出 JSON：{"p":[{"t":"d","x":"原句"}]}
t 取值：d=对白 a=动作 e=环境 n=旁白/心理。
保持原文不变，逐句拆分，只输出 JSON，无其他文字。`;

const PROMPT_C = `下面是已编号的句子，逐句分类。只输出 JSON：{"l":[{"i":0,"t":"d"}]}
t 取值：d=对白 a=动作 e=环境 n=旁白/心理。
i 为句子序号。不要重复原文，只输出 JSON，无其他文字。`;

function extractJson(raw) {
  let s = raw.trim();
  const tc = s.lastIndexOf('</think>');
  if (tc >= 0) s = s.slice(tc + 8).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  const starts = [s.indexOf('{'), s.indexOf('[')].filter((i) => i >= 0);
  if (starts.length) {
    const a = Math.min(...starts);
    const b = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (b > a) s = s.slice(a, b + 1);
  }
  return s;
}

const sentences = splitSentences(SAMPLE);

const SCHEMES = {
  A_baseline: {
    label: 'A 基线(重吐全文+全名type)',
    system: PROMPT_A,
    user: SAMPLE,
    parse(content) {
      try {
        const d = JSON.parse(extractJson(content));
        const arr = Array.isArray(d) ? d : d.parts;
        if (!Array.isArray(arr) || arr.length === 0) return { ok: false };
        const parts = arr.filter((p) => p && typeof p.text === 'string' && p.text.trim());
        if (!parts.length) return { ok: false };
        const allValid = parts.every((p) => VALID.has(p.type));
        return { ok: allValid, parts };
      } catch { return { ok: false }; }
    },
  },
  B_compact: {
    label: 'B 紧凑(重吐全文+1字码)',
    system: PROMPT_B,
    user: SAMPLE,
    parse(content) {
      try {
        const d = JSON.parse(extractJson(content));
        const arr = d.p ?? d.parts;
        if (!Array.isArray(arr) || arr.length === 0) return { ok: false };
        const parts = arr
          .filter((p) => p && typeof (p.x ?? p.text) === 'string' && (p.x ?? p.text).trim())
          .map((p) => ({ type: CODE2TYPE[p.t] ?? 'narration', text: p.x ?? p.text }));
        return { ok: parts.length > 0, parts };
      } catch { return { ok: false }; }
    },
  },
  C_index: {
    label: 'C 序号贴标签(不吐原文)',
    system: PROMPT_C,
    user: sentences.map((s, i) => `${i}: ${s}`).join('\n'),
    parse(content) {
      try {
        const d = JSON.parse(extractJson(content));
        const arr = d.l ?? d.labels;
        if (!Array.isArray(arr)) return { ok: false };
        const byIdx = new Map(arr.map((o) => [o.i, CODE2TYPE[o.t] ?? 'narration']));
        // 服务端用自己的句子重建，缺标签的句默认 narration
        const parts = sentences.map((text, i) => ({ type: byIdx.get(i) ?? 'narration', text }));
        // 完整 = 模型给每句都贴了合法标签
        const complete = sentences.every((_, i) => byIdx.has(i));
        return { ok: complete, parts };
      } catch { return { ok: false }; }
    },
  },
};

async function streamCall(system, user) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CALL_TIMEOUT_MS);
  const t0 = Date.now();
  let ttft = null;
  let content = '';
  let completionTokens = null;
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: 0.3,
        max_tokens: 2048,
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { error: `HTTP ${res.status}: ${txt.slice(0, 120)}` };
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
        if (j.usage?.completion_tokens != null) completionTokens = j.usage.completion_tokens;
      }
    }
    const total = Date.now() - t0;
    return { total, ttft: ttft ?? total, decode: total - (ttft ?? total), content, completionTokens };
  } catch (e) {
    return { error: e.name === 'AbortError' ? `timeout ${CALL_TIMEOUT_MS}ms` : String(e.message) };
  } finally {
    clearTimeout(timer);
  }
}

function stats(nums) {
  if (!nums.length) return { n: 0 };
  const s = [...nums].sort((a, b) => a - b);
  const sum = s.reduce((a, b) => a + b, 0);
  return {
    n: s.length,
    min: s[0],
    median: s[Math.floor(s.length / 2)],
    max: s[s.length - 1],
    mean: Math.round(sum / s.length),
  };
}

async function run() {
  console.log(`# 分句侧袋延时基准  model=${MODEL}  rounds=${ROUNDS}`);
  console.log(`样本：${SAMPLE.length} 字，确定性切句 = ${sentences.length} 句\n`);
  const results = {};
  for (const [key, scheme] of Object.entries(SCHEMES)) {
    console.log(`\n=== ${key}  ${scheme.label} ===`);
    // 预热一发（不计入）
    process.stdout.write('  warmup... ');
    const w = await streamCall(scheme.system, scheme.user);
    console.log(w.error ? `(warmup err: ${w.error})` : `(warmup ${w.total}ms)`);

    const rows = [];
    for (let i = 0; i < ROUNDS; i++) {
      const r = await streamCall(scheme.system, scheme.user);
      if (r.error) {
        console.log(`  round ${i + 1}: ERROR ${r.error}`);
        rows.push({ error: r.error });
        continue;
      }
      const p = scheme.parse(r.content);
      rows.push({ ...r, complete: p.ok, nParts: p.parts?.length ?? 0 });
      console.log(
        `  round ${i + 1}: total=${r.total}ms ttft=${r.ttft}ms decode=${r.decode}ms ` +
        `outTok=${r.completionTokens ?? '?'} parts=${p.parts?.length ?? 0} complete=${p.ok ? '✓' : '✗'}`,
      );
    }
    results[key] = rows;
  }

  // ── 汇总：只统计 complete 轮次 ──
  console.log('\n\n========== 汇总（只计解析完整的轮次）==========');
  console.log('方案'.padEnd(28), 'complete'.padEnd(10), 'decode中位'.padEnd(12), 'total中位'.padEnd(12), 'outTok中位');
  for (const [key, rows] of Object.entries(results)) {
    const ok = rows.filter((r) => r.complete);
    const dStat = stats(ok.map((r) => r.decode));
    const tStat = stats(ok.map((r) => r.total));
    const okStat = stats(ok.map((r) => r.completionTokens).filter((x) => x != null));
    console.log(
      key.padEnd(28),
      `${ok.length}/${rows.length}`.padEnd(10),
      `${dStat.median ?? '-'}ms`.padEnd(12),
      `${tStat.median ?? '-'}ms`.padEnd(12),
      `${okStat.median ?? '-'}`,
    );
  }
}

run().catch((e) => { console.error(e); process.exit(1); });
