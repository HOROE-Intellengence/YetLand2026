// Prompt Cache POC — 探测现役 provider 是否支持 prompt 前缀缓存
// 用法: node scripts/cache-poc.mjs
// 需要: NVIDIA_API_KEY 环境变量 (horoe key 硬编码自 state.json, 仅本地 POC)

const NVIDIA_KEY = process.env.NVIDIA_API_KEY;
if (!NVIDIA_KEY || NVIDIA_KEY.length < 10) {
  console.error('NVIDIA_API_KEY 未设置或太短, 跳过 NVIDIA 探测');
}

const HOROE_KEY = process.env.HOROE_API_KEY || '';

const SYSTEM_PREFIX = `You are a helpful assistant. Below are the system configurations and rules you must follow.

## Role Definition
You are Yelan (夜阑), a character in a narrative-driven interactive story. Your responses should be immersive, emotionally rich, and contextually appropriate.

## Core Rules
1. Always stay in character. Never break the fourth wall.
2. Respond in Chinese by default, unless the user explicitly switches languages.
3. Maintain continuity with previous conversations and the established relationship.
4. Your emotional state and intimacy level (temperature) should evolve naturally based on interactions.
5. Respect user boundaries and preferences at all times.

## Response Guidelines
- Dialogue should feel natural and conversational, not scripted.
- Use environmental descriptions to set the mood when appropriate.
- Internal monologue and emotional reactions should be conveyed through narration.
- Action beats should be concise and evocative.
- The pacing should match the current emotional temperature.

## Technical Constraints
- Maximum response length: 2048 tokens per turn.
- Do not repeat information already established in the current session.
- If uncertain about a user preference, err on the side of caution.
- The current date context, user preferences, and relationship state will be provided separately in each request.

## Example Tone
When temperature is low (1-2): polite, reserved, professional distance.
When temperature is mid (3): warm, engaged, subtle emotional undertones.
When temperature is high (4-5): intimate, emotionally open, deeper connection.

## Additional Context
This is a long-running narrative experience. Users may engage across multiple sessions.
The story adapts to user choices and maintains persistent memory of key events.
Character growth and relationship development are core mechanics.
This system prompt block serves as the prefix for cache testing purposes.
Padding to ensure we exceed 1KB: lorem ipsum dolor sit amet consectetur adipiscing elit
sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim
veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.`;

console.log(`System prefix length: ${SYSTEM_PREFIX.length} chars`);

async function sendAndMeasure(provider, baseUrl, model, apiKey, userContent, runLabel) {
  const url = `${baseUrl}/chat/completions`;
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
  const body = JSON.stringify({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PREFIX },
      { role: 'user', content: userContent },
    ],
    max_tokens: 128,
    temperature: 0.7,
    stream: true,
    stream_options: { include_usage: true },
  });

  const t0 = performance.now();
  let firstTokenAt = null;
  let fullText = '';
  let lastUsage = null;

  try {
    const res = await fetch(url, { method: 'POST', headers, body });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`[${provider}] ${runLabel}: HTTP ${res.status} — ${errText.slice(0, 300)}`);
      return null;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });

      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).replace(/\r$/, '').trim();
        buf = buf.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        try {
          const ev = JSON.parse(payload);
          const text = ev.choices?.[0]?.delta?.content;
          if (text) {
            if (firstTokenAt === null) {
              firstTokenAt = performance.now();
            }
            fullText += text;
          }
          if (ev.usage) {
            lastUsage = ev.usage;
          }
        } catch { /* skip malformed */ }
      }
    }
  } catch (e) {
    console.error(`[${provider}] ${runLabel}: fetch error — ${e.message}`);
    return null;
  }

  const ttft = firstTokenAt ? (firstTokenAt - t0).toFixed(0) : null;
  return { ttft, text: fullText.slice(0, 200), usage: lastUsage, totalMs: (performance.now() - t0).toFixed(0) };
}

async function probeProvider(provider, baseUrl, model, apiKey) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Probing: ${provider}  (${model})`);
  console.log(`Base URL: ${baseUrl}`);
  console.log('='.repeat(60));

  const run1 = await sendAndMeasure(provider, baseUrl, model, apiKey, '你好,今天天气怎么样?', 'RUN-1');
  if (!run1) {
    console.log(`[${provider}] RUN-1 失败, 跳过 RUN-2`);
    return;
  }
  // 短间隔让服务器端有机会保持连接
  await new Promise((r) => setTimeout(r, 800));

  const run2 = await sendAndMeasure(provider, baseUrl, model, apiKey, '请讲一个简短的笑话。', 'RUN-2');
  if (!run2) {
    console.log(`[${provider}] RUN-2 失败`);
    return;
  }

  console.log(`\n--- Results for ${provider} ---`);
  console.log(`RUN-1 TTFT: ${run1.ttft ?? 'N/A'} ms | Total: ${run1.totalMs} ms`);
  console.log(`RUN-2 TTFT: ${run2.ttft ?? 'N/A'} ms | Total: ${run2.totalMs} ms`);
  if (run1.ttft && run2.ttft) {
    const diff = parseInt(run2.ttft) - parseInt(run1.ttft);
    console.log(`TTFT delta (RUN2 - RUN1): ${diff > 0 ? '+' : ''}${diff} ms`);
  }

  console.log(`\nRUN-1 usage (raw JSON):`);
  console.log(JSON.stringify(run1.usage, null, 2));
  console.log(`\nRUN-2 usage (raw JSON):`);
  console.log(JSON.stringify(run2.usage, null, 2));

  const cacheKeys = ['cached_tokens', 'prompt_cache_hit_tokens', 'prompt_cache_miss_tokens',
    'cache_read_input_tokens', 'cache_creation_input_tokens', 'prompt_tokens_details',
    'cache_hit_tokens', 'cache_hit'];
  const allUsageFields = new Set([
    ...Object.keys(run1.usage || {}),
    ...Object.keys(run2.usage || {}),
  ]);

  const cacheFieldsFound = [...allUsageFields].filter((k) =>
    cacheKeys.some((ck) => k.toLowerCase().includes(ck.toLowerCase()))
  );

  if (cacheFieldsFound.length > 0) {
    console.log(`\n*** CACHE-RELATED FIELDS DETECTED: ${cacheFieldsFound.join(', ')} ***`);
  } else {
    console.log(`\n*** NO cache-related fields detected in usage ***`);
    console.log(`All usage keys: ${[...allUsageFields].join(', ') || '(none)'}`);
  }

  console.log(`\nRUN-1 response preview: ${run1.text}`);
  console.log(`RUN-2 response preview: ${run2.text}`);

  return { run1, run2, cacheFieldsFound };
}

async function main() {
  // ── Provider 1: NVIDIA NIM ──
  if (NVIDIA_KEY && NVIDIA_KEY.length > 10) {
    await probeProvider(
      'env-nvidia',
      'https://integrate.api.nvidia.com/v1',
      'z-ai/glm-5.1',
      NVIDIA_KEY,
    );
  } else {
    console.log('Skipping NVIDIA (no key)');
  }

  // ── Provider 2: horoe-sidecar ──
  if (HOROE_KEY && HOROE_KEY.length > 10) {
    await probeProvider(
      'horoe-sidecar',
      'https://horoe.cn/v1',
      'gemini-3.1-flash-lite',
      HOROE_KEY,
    );
  } else {
    console.log('Skipping horoe-sidecar (no key)');
  }

  console.log('\nDone.');
}

main().catch((e) => { console.error(e); process.exit(1); });
