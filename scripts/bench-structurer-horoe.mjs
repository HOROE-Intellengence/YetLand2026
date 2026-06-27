// 分句侧袋延时基准 — 真实端点版（horoe-sidecar = gemini-3.1-flash-lite @ https://horoe.cn/v1）。
//
// 与旧 bench-structurer.mjs 的区别：
//   - 打真实侧袋端点（从 apps/api/.local/state.json 的 sidecarApiId 条目读 baseUrl/model/apiKey），
//     不再用 NVIDIA NIM/glm-5.1（那是错端点，20-25s 是排队伪影）。
//   - 复用线上真实逻辑：prompts.ts 的 outputStructurer 提示词 + client.ts 的 extractSidecarJson 三步归一
//     + output-structurer.ts 的 normalizeStructurerParts / coerceStructurerParts，
//     保证「完整 / 降级」判定与线上一致。
//   - 矩阵：输入长度(短/中/长) × max_tokens(1024/2048)，每组 1 warmup + N 轮，串行。
//   - 流式打点拆 TTFT / decode / total（注意：生产链路非流式，TTFT 不可兑现，仅供分析拆解）。
//
// 安全：apiKey 只从 state.json 读入内存用于请求头，绝不打印 / 入库。
// 用法：node scripts/bench-structurer-horoe.mjs [--rounds=15]

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const argVal = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || '').split('=')[1] || '';
const ROUNDS = Number(argVal('rounds')) || 15;
const CALL_TIMEOUT_MS = 45000; // 单发上限防卡死；远大于 8000ms 生产预算，以便观测「本可完成但超预算」的轮次
const MAX_TOKENS_VARIANTS = [1024, 2048];
// 只跑指定长度档（逗号分隔，如 --lens=xlong）；缺省跑全部。--out= 指定结果文件名。
const LENS_FILTER = argVal('lens') ? argVal('lens').split(',').map((s) => s.trim()) : null;
const OUT_FILE = argVal('out') || 'scripts/.bench-horoe-results.json';

// 抗 horoe.cn 卡顿/限流的节流参数（首跑教训：零间隔猛打 + 一发卡死 → 连接池被打坏 → 后续全 fetch failed 级联）：
const PACING_MS = 2500; // 每发之间的固定间隔，避免触发代理限流
const ERROR_COOLDOWN_MS = 10000; // 任一发出错后额外冷却，给代理回血、阻断级联
const MAX_NET_RETRIES = 3; // 仅对「连接级 fetch failed」（瞬时网络/被污染 socket）退避重试；真正超时计入降级不重试
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 生产预算（来自源码，非假设）：
//   OUTPUT_STRUCTURER_TIMEOUT_MS = 8000  (output-structurer.ts:10 → sidecarCall 的 abort)
//   STRUCTURER_BUDGET_MS = 8000 + 500 = 8500  (chat.ts:38 → Promise.race)
// sidecarCall 自身 8000ms abort 先触发，故「有效天花板」= 8000ms。
const BUDGET_ABORT_MS = 8000;
const BUDGET_RACE_MS = 8500;

// ── 1) 读真实端点（不打印 key）────────────────────────────────────────────
function resolveStateFile() {
  if (process.env.YELAN_STATE_FILE) return resolve(process.env.YELAN_STATE_FILE);
  const dir = process.env.YELAN_STATE_DIR ? resolve(process.env.YELAN_STATE_DIR) : resolve(repoRoot, 'apps', 'api', '.local');
  return join(dir, 'state.json');
}
const stateFile = resolveStateFile();
const state = JSON.parse(readFileSync(stateFile, 'utf8'));
const inv = state.llmApiInventory;
const sidecarId = inv?.sidecarApiId;
const entry = sidecarId ? inv.entries?.[sidecarId] : null;
if (!entry) {
  console.error(`✗ 找不到 sidecarApiId(${sidecarId}) 指向的条目`);
  process.exit(1);
}
const BASE_URL = String(entry.baseUrl).replace(/\/+$/, '');
const MODEL = entry.model;
const API_KEY = entry.apiKey;
if (!API_KEY || API_KEY.length <= 10) {
  console.error('✗ 侧袋条目无有效 apiKey');
  process.exit(1);
}
const mask = (v) => (v.length <= 10 ? '****' : `${v.slice(0, 4)}...${v.slice(-4)}`);

// ── 2) 真实提示词：从 prompts.ts 原样抽取 outputStructurer 模板字符串 ──────────
function loadRealPrompt() {
  const t = readFileSync(resolve(repoRoot, 'apps/api/src/sidecar-ai/prompts.ts'), 'utf8');
  const m = t.match(/outputStructurer:\s*`([\s\S]*?)`,/);
  if (!m) throw new Error('无法从 prompts.ts 抽取 outputStructurer 提示词');
  return m[1];
}
const SYSTEM_PROMPT = loadRealPrompt();

// ── 3) 复用线上解析逻辑（照搬 client.ts / output-structurer.ts）──────────────
const VALID_PART_TYPES = new Set(['dialogue', 'action', 'environment', 'narration']);

function extractSidecarJson(raw) {
  let s = raw.trim();
  const thinkClose = s.lastIndexOf('</think>');
  if (thinkClose >= 0) s = s.slice(thinkClose + '</think>'.length).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) s = fence[1].trim();
  const starts = [s.indexOf('{'), s.indexOf('[')].filter((i) => i >= 0);
  if (starts.length > 0) {
    const start = Math.min(...starts);
    const end = Math.max(s.lastIndexOf('}'), s.lastIndexOf(']'));
    if (end > start) s = s.slice(start, end + 1);
  }
  return s;
}

function normalizeStructurerParts(data) {
  if (Array.isArray(data)) return { parts: data };
  if (data && typeof data === 'object' && Array.isArray(data.parts)) return { parts: data.parts };
  return { parts: [] };
}

function coerceStructurerParts(parts) {
  const out = [];
  for (const raw of parts) {
    if (!raw || typeof raw !== 'object') continue;
    const text = raw.text;
    if (typeof text !== 'string' || !text.trim()) continue;
    const rawType = raw.type;
    const type = typeof rawType === 'string' && VALID_PART_TYPES.has(rawType) ? rawType : 'narration';
    out.push({ type, text });
  }
  return out;
}

// 严格 schema 在「原始 parts」上的反事实判定（OutputStructurerResultSchema）：
// 每个 part 必须 {type∈四选一, text:string} 且 parts 非空 → 用于度量 coerce 救回了多少轮。
function strictRawOk(normalizedParts) {
  if (!Array.isArray(normalizedParts) || normalizedParts.length === 0) return false;
  return normalizedParts.every(
    (p) => p && typeof p === 'object' && typeof p.type === 'string' && VALID_PART_TYPES.has(p.type) && typeof p.text === 'string',
  );
}

// ── 4) 三档真实样本（台词/动作(括号)/环境/旁白 混合）────────────────────────
const SAMPLES = {
  short:
    '（他抬眼，合上手里摊开的书，往旁边挪了挪给你腾出位置。）来了？坐吧，茶还温着。' +
    '其实我等了你有一会儿了，只是没必要说出来。',
  // 截图里那条真实多句回复
  mid:
    '是。上次见，还是那场学术沙龙。（他侧身，把刚沏好的茶杯推到你手边，杯沿的温度刚好。）' +
    '这里比那时安静些。坐。没忘。只是觉得，没必要说那么多废话。' +
    '（他放下手中正在勾勒图纸的铅笔，转过头，视线越过镜框边缘落在你脸上。）' +
    '不想见，就不会把门锁的密码留给你。' +
    '（他转过身，背靠着书架，目光在你身上停留了三秒，语气平淡。）别多想。',
  // 长回复刻意放大到 ~700 字，使结构化 JSON 的 completion 超过 1024 token —
  // 这样 1024 上限会 finish_reason=length 截断、JSON.parse 失败，而 2048 不截，
  // 正是用来度量 max_tokens 改动「降了多少长回复截断率」的对照样本。
  long:
    '门在身后轻轻合上，隔绝了走廊里残留的喧嚣。（他没有立刻回头，只是把钢笔搁在摊开的图纸上，' +
    '指尖在桌沿点了两下。）你来得比我预计的早。屋里很暖，壁炉的火噼啪作响，把书架的影子拉得很长，' +
    '空气里浮着旧纸张和雪松的味道。（他终于转过身，借着台灯昏黄的光，把一杯还冒着热气的茶推到你面前，' +
    '动作很轻，像是怕惊扰了什么。）外面雪下大了吧。把外套脱了，挂在炉边，别冻着。' +
    '我知道你今晚不是为了寒暄才来的。其实从你上次离开那天起，我就大概猜到会有这么一次谈话，' +
    '只是没想到会拖这么久。（他在你对面坐下，身体微微前倾，手肘抵着膝盖，目光沉静地落在你脸上，' +
    '没有半分回避。）那么，说吧。这一次，我不会再像从前那样，把话咽回去。' +
    '窗外的风掠过屋檐，发出一声低低的呜咽，像是替谁把没说出口的话叹了出来。' +
    '（他端起自己那杯茶，却没有喝，只是用掌心捂着杯壁，任那点温度一寸寸渗进骨头里。）' +
    '你还记得我们第一次在档案馆地下室碰面的样子吗。那时候你抱着一摞快要散架的卷宗，' +
    '头也不抬地从我身边擦过去，连一句多余的话都不肯施舍。我当时就想，这个人，' +
    '要么会成为我最棘手的对手，要么……（他顿了顿，喉结轻轻滚动了一下，把后半句重新压回了胸腔。）' +
    '算了，过去的事，重提也没什么意思。窗台上的旧座钟不紧不慢地走着，秒针的声音在安静的屋里格外清晰。' +
    '（他重新拿起那支钢笔，在图纸的空白处无意识地画着一个又一个相互嵌套的圆，仿佛在借这点细碎的动作' +
    '稳住自己的声音。）这些年我学会了一件事——有些话一旦错过了说出口的时机，就再也找不回当初的分量。' +
    '所以这一次，我不打算等到合适的时机了，因为对我们来说，从来就没有过什么合适的时机。' +
    '茶要凉了。先喝一口暖暖手，剩下的，我们可以慢慢说，今晚的时间，我全都留给你了。' +
    '我只是想让你知道，无论你今晚做出什么决定，这扇门，对你始终是开着的。',
  // 超长回复：实测 751 字仅 ~833 completion token，1024 不截断。要验证 max_tokens 改动，
  // 需让结构化 JSON 的 completion 稳超 1024 token。这一档 ~1200 字 → 预期 ~1300+ token，
  // 1024 必 finish_reason=length 截断、JSON.parse 失败；2048 完整。是「截断专项」的对照样本。
  xlong:
    '门在身后轻轻合上，隔绝了走廊里残留的喧嚣。（他没有立刻回头，只是把钢笔搁在摊开的图纸上，' +
    '指尖在桌沿点了两下，像是在数着什么看不见的节拍。）你来得比我预计的早。屋里很暖，' +
    '壁炉的火噼啪作响，把书架的影子拉得很长，空气里浮着旧纸张和雪松的味道，还有一丝若有若无的墨香。' +
    '（他终于转过身，借着台灯昏黄的光，把一杯还冒着热气的茶推到你面前，动作很轻，像是怕惊扰了什么。）' +
    '外面雪下大了吧。把外套脱了，挂在炉边，别冻着。我知道你今晚不是为了寒暄才来的。' +
    '其实从你上次离开那天起，我就大概猜到会有这么一次谈话，只是没想到会拖这么久。' +
    '（他在你对面坐下，身体微微前倾，手肘抵着膝盖，目光沉静地落在你脸上，没有半分回避。）' +
    '那么，说吧。这一次，我不会再像从前那样，把话咽回去。窗外的风掠过屋檐，发出一声低低的呜咽，' +
    '像是替谁把没说出口的话叹了出来。（他端起自己那杯茶，却没有喝，只是用掌心捂着杯壁，' +
    '任那点温度一寸寸渗进骨头里。）你还记得我们第一次在档案馆地下室碰面的样子吗。' +
    '那时候你抱着一摞快要散架的卷宗，头也不抬地从我身边擦过去，连一句多余的话都不肯施舍。' +
    '我当时就想，这个人，要么会成为我最棘手的对手，要么……（他顿了顿，喉结轻轻滚动了一下，' +
    '把后半句重新压回了胸腔。）算了，过去的事，重提也没什么意思。窗台上的旧座钟不紧不慢地走着，' +
    '秒针的声音在安静的屋里格外清晰。（他重新拿起那支钢笔，在图纸的空白处无意识地画着一个又一个' +
    '相互嵌套的圆，仿佛在借这点细碎的动作稳住自己的声音。）这些年我学会了一件事——' +
    '有些话一旦错过了说出口的时机，就再也找不回当初的分量。所以这一次，我不打算等到合适的时机了，' +
    '因为对我们来说，从来就没有过什么合适的时机。炉膛里的木柴塌了一块，溅起一小簇火星，' +
    '又很快归于沉寂。（他抬眼看你，眼神里有种近乎执拗的认真。）你大概一直觉得我是个滴水不漏的人，' +
    '凡事都算得清清楚楚，连退路都铺好了三条。可你不知道的是，这间屋子里所有的图纸、所有的推演，' +
    '唯独关于你的那一部分，我从来没有算赢过一次。（他低下头，看着自己摊在膝上的手，骨节分明，' +
    '指腹还沾着一点没擦净的石墨灰，声音放得很轻，几乎像是说给自己听。）每一次我以为把你看透了，' +
    '你就会用一种我完全没预料到的方式，把我精心搭起来的那套逻辑，轻轻巧巧地推倒重来。' +
    '说来可笑，一个靠预测和控制吃饭的人，偏偏在最该冷静的时候，一次又一次地失了准头。' +
    '（窗外又是一阵风，灯影晃了晃，他却没有移开目光。）所以今晚，我不想再算了。' +
    '我只想问你一句，剩下的路，你愿不愿意，和我一起走完。茶要凉了。先喝一口暖暖手，' +
    '剩下的，我们可以慢慢说，今晚的时间，我全都留给你了。我只是想让你知道，' +
    '无论你今晚做出什么决定，这扇门，对你始终是开着的，从来都是。',
};

// ── 5) 流式单发 ──────────────────────────────────────────────────────────
async function streamCall(system, user, maxTokens) {
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
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        max_tokens: maxTokens,
        response_format: { type: 'json_object' },
        stream: true,
        stream_options: { include_usage: true },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { error: `HTTP ${res.status}: ${txt.slice(0, 120)}`, httpStatus: res.status, elapsed: Date.now() - t0 };
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

// 仅对「连接级 fetch failed」（瞬时网络 / 被污染 socket，通常 elapsed 很短）退避重试；
// 真正的 timeout（abort）= 模型卡顿，是要统计的真实降级，不重试。
async function callWithRetry(system, user, maxTokens) {
  let attempts = 0;
  let netRetries = 0;
  for (;;) {
    attempts++;
    const r = await streamCall(system, user, maxTokens);
    if (!r.error) return { ...r, attempts, netRetries };
    if (/timeout/.test(r.error)) return { ...r, attempts, netRetries }; // 真实超时降级
    // 连接级失败：退避重试
    if (netRetries >= MAX_NET_RETRIES) return { ...r, attempts, netRetries, exhausted: true };
    netRetries++;
    await sleep(ERROR_COOLDOWN_MS * netRetries); // 逐次拉长冷却
  }
}

// ── 6) 一轮的完整判定 + 降级原因分类（对齐线上）──────────────────────────────
function evaluate(r) {
  // 网络/HTTP 层失败：timeout=模型卡顿；http=4xx/5xx；network=连接级 fetch failed（重试耗尽）
  if (r.error) {
    const reason = /timeout/.test(r.error) ? 'timeout' : /^HTTP /.test(r.error) ? 'http' : 'network';
    return { ok: false, reason, parseComplete: false, coerceRescued: false };
  }
  // 解析：extractSidecarJson → JSON.parse
  let parsed;
  try {
    parsed = JSON.parse(extractSidecarJson(r.content));
  } catch {
    return { ok: false, reason: 'parse', parseComplete: false, coerceRescued: false, nParts: 0 };
  }
  const normalized = normalizeStructurerParts(parsed);
  const coerced = coerceStructurerParts(normalized.parts);
  const parseComplete = coerced.length > 0; // 线上成功条件（coerce 后 ≥1 句）
  const rawOk = strictRawOk(normalized.parts);
  const coerceRescued = parseComplete && !rawOk; // 原始 schema 会败、但 coerce 救回
  if (!parseComplete) {
    return { ok: false, reason: 'schema', parseComplete: false, coerceRescued: false, nParts: 0 };
  }
  // 解析完整，但是否撑得住预算？total ≥ 8000ms 在线上会被 sidecarCall abort → timeout 降级
  if (r.total >= BUDGET_ABORT_MS) {
    return { ok: false, reason: 'timeout', parseComplete: true, coerceRescued, nParts: coerced.length };
  }
  return { ok: true, reason: '', parseComplete: true, coerceRescued, nParts: coerced.length };
}

// ── 7) 统计 ──────────────────────────────────────────────────────────────
function pct(nums, p) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1);
  return s[Math.max(0, idx)];
}
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

async function run() {
  console.log(`# 分句侧袋基准（真实端点）`);
  console.log(`endpoint = ${BASE_URL}  model = ${MODEL}  key = ${mask(API_KEY)}`);
  console.log(`rounds/组 = ${ROUNDS}  预算: abort=${BUDGET_ABORT_MS}ms race=${BUDGET_RACE_MS}ms  单发上限=${CALL_TIMEOUT_MS}ms`);
  console.log(`提示词长度 = ${SYSTEM_PROMPT.length} 字  样本: short=${SAMPLES.short.length} mid=${SAMPLES.mid.length} long=${SAMPLES.long.length} 字\n`);

  const all = [];
  for (const [lenKey, sample] of Object.entries(SAMPLES)) {
    if (LENS_FILTER && !LENS_FILTER.includes(lenKey)) continue;
    for (const maxTokens of MAX_TOKENS_VARIANTS) {
      const group = `${lenKey}×${maxTokens}`;
      console.log(`\n=== ${group} (${sample.length}字) ===`);
      await sleep(PACING_MS);
      process.stdout.write('  warmup... ');
      const w = await callWithRetry(SYSTEM_PROMPT, sample, maxTokens);
      console.log(w.error ? `(err: ${w.error}${w.netRetries ? ` after ${w.netRetries} retries` : ''})` : `(${w.total}ms, finish=${w.finishReason})`);
      if (w.error) await sleep(ERROR_COOLDOWN_MS);

      const rows = [];
      for (let i = 0; i < ROUNDS; i++) {
        await sleep(PACING_MS);
        const r = await callWithRetry(SYSTEM_PROMPT, sample, maxTokens);
        const ev = evaluate(r);
        const row = {
          group, lenKey, maxTokens,
          total: r.total ?? null, ttft: r.ttft ?? null, decode: r.decode ?? null,
          completionTokens: r.completionTokens ?? null, finishReason: r.finishReason ?? null,
          error: r.error ?? null, netRetries: r.netRetries ?? 0, ...ev,
        };
        rows.push(row);
        all.push(row);
        console.log(
          `  ${String(i + 1).padStart(2)}: ` +
          (r.error
            ? `ERROR ${r.error}${r.netRetries ? ` (after ${r.netRetries} retries)` : ''} → DEGRADE:${ev.reason}`
            : `total=${String(r.total).padStart(5)}ms ttft=${String(r.ttft).padStart(5)}ms decode=${String(r.decode).padStart(5)}ms ` +
              `outTok=${String(r.completionTokens ?? '?').padStart(4)} finish=${(r.finishReason ?? '?').padEnd(6)} ` +
              `parts=${ev.nParts ?? 0} ${ev.ok ? 'OK ' : 'DEGRADE:' + ev.reason}${ev.coerceRescued ? ' (coerce救回)' : ''}` +
              `${r.netRetries ? ` [${r.netRetries} retries]` : ''}`),
        );
        if (r.error) await sleep(ERROR_COOLDOWN_MS); // 出错后冷却，阻断级联
      }
    }
  }

  // ── 汇总表 ──
  console.log('\n\n========== 汇总（按 输入长度×max_tokens）==========');
  const header = ['组', '完整率', 'OK率(含预算)', 'timeout', 'parse', 'schema', 'http', 'network', 'trunc(len)', 'coerce救回',
    't.P50', 't.P90', 't.P99', 't.max', 'ttft.P50', 'dec.P50', 'outTok中位'];
  console.log(header.join('\t'));
  const groups = [...new Set(all.map((r) => r.group))];
  const summary = [];
  for (const g of groups) {
    const rows = all.filter((r) => r.group === g);
    const totals = rows.filter((r) => r.total != null).map((r) => r.total);
    const okRows = rows.filter((r) => r.ok);
    const parseCompleteRows = rows.filter((r) => r.parseComplete);
    const completeTotals = parseCompleteRows.map((r) => r.total).filter((x) => x != null);
    const cnt = (rsn) => rows.filter((r) => !r.ok && r.reason === rsn).length;
    const trunc = rows.filter((r) => r.finishReason === 'length').length;
    const rescued = rows.filter((r) => r.coerceRescued).length;
    const rec = {
      group: g,
      n: rows.length,
      completeRate: `${parseCompleteRows.length}/${rows.length}`,
      okRate: `${okRows.length}/${rows.length}`,
      timeout: cnt('timeout'), parse: cnt('parse'), schema: cnt('schema'), http: cnt('http'), network: cnt('network'),
      truncLength: trunc, coerceRescued: rescued,
      total_p50: median(completeTotals), total_p90: pct(completeTotals, 90), total_p99: pct(completeTotals, 99), total_max: totals.length ? Math.max(...totals) : null,
      ttft_p50: median(parseCompleteRows.map((r) => r.ttft).filter((x) => x != null)),
      decode_p50: median(parseCompleteRows.map((r) => r.decode).filter((x) => x != null)),
      outTok_median: median(parseCompleteRows.map((r) => r.completionTokens).filter((x) => x != null)),
    };
    summary.push(rec);
    console.log([
      rec.group, rec.completeRate, rec.okRate, rec.timeout, rec.parse, rec.schema, rec.http, rec.network,
      rec.truncLength, rec.coerceRescued,
      rec.total_p50, rec.total_p90, rec.total_p99, rec.total_max, rec.ttft_p50, rec.decode_p50, rec.outTok_median,
    ].join('\t'));
  }

  // 落盘原始数据（仅含样本/延时/token，无 key）供生成报告
  const out = { meta: { endpoint: BASE_URL, model: MODEL, rounds: ROUNDS, budgetAbortMs: BUDGET_ABORT_MS, budgetRaceMs: BUDGET_RACE_MS, runAt: new Date().toISOString(), promptLen: SYSTEM_PROMPT.length, sampleLens: Object.fromEntries(Object.entries(SAMPLES).map(([k, v]) => [k, v.length])) }, summary, rows: all };
  const outFile = resolve(repoRoot, OUT_FILE);
  writeFileSync(outFile, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\n原始结果已写入: ${outFile}`);
}

run().catch((e) => { console.error(e); process.exit(1); });
