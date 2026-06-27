// 10 轮一致性探针 —— 验证发送给主 AI 的 system prompt 是否按规则注入/省略
// 用法：DEBUG_SYSTEM_PROMPT=on FEATURE_MEMORY_THROTTLE=on pnpm --filter @yelan/api exec tsx scripts/probe-10rounds.ts
import { store } from '../src/store/persistence';
import { clearFlagCache } from '../src/config/feature-flags';
import { mockChatRoute } from '../src/routes/chat';
import { setSummary } from '../src/sidecar-ai/context-compressor';

function setup() {
  store.__resetForTests();
  const userId = 'usr_p10';
  const token = 'tok_p10';
  store.state().users[userId] = {
    id: userId, phone: '13800002222', token,
    ageVerified: true, narrativeBoundary: 2, ifUnlocked: false,
    createdAt: new Date().toISOString(), candle: 100, registerGrant: 100,
  };
  store.state().tokenIndex[token] = userId;
  store.state().phoneIndex['13800002222'] = userId;
  store.state().characters['p10-char'] = {
    id: 'p10-char', slug: 'p10', name: '夜阑', rarity: 'free', priceCandle: 0,
    styleTags: [], boundaryDefault: 2, isActive: true,
    openingFirstVisit: '你来了。', openingReturnVisit: '又见面了。',
    forbiddenPhrases: [], description: '冷静克制',
    updatedAt: new Date().toISOString(),
  };
  // 种 profile + summary，方便观察 [用户画像]/[旧对话概要] 注入与否
  (store.state() as any).userProfiles = {
    [userId]: { markdown: '## 用户画像\n- 偏好克制叙事\n- 雷点：被叫小可爱', updatedAt: new Date().toISOString() },
  };
  setSummary('sess_p10', '## 旧对话概要\n- 用户主动靠近\n- 关系：初步信任');
  store.save();
  return { userId, token };
}

interface RoundOpts {
  token: string; round: number; prevStage: 'daily' | 'rise' | 'climax' | 'after' | 'end';
  text: string; label: string; expectInject: boolean; expectReason: string;
}

async function sendRound(opts: RoundOpts) {
  const body = {
    characterId: 'p10-char', sessionId: 'sess_p10',
    round: opts.round, prevStage: opts.prevStage, userBoundary: 2,
    text: opts.text, history: [],
    recall: {
      preferences: ['用户排斥"小可爱"称呼'],
      events: [{ date: '今天', text: '用户首次主动靠近', emotion: '紧张' }],
    },
  };
  const res = await mockChatRoute.request('/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.token}`, Accept: 'text/event-stream' },
    body: JSON.stringify(body),
  });
  await res.text();
  return { round: opts.round, label: opts.label, expectInject: opts.expectInject, expectReason: opts.expectReason };
}

async function main() {
  const { token } = setup();

  // 10 轮覆盖：first-turn → throttled×3 → elapsed → throttled → keyword → throttled → stage-change → throttled
  const plan: RoundOpts[] = [
    { token, round: 0, prevStage: 'daily', text: '你好',                   label: 'R0  first-turn',    expectInject: true,  expectReason: 'first-turn' },
    { token, round: 1, prevStage: 'daily', text: '嗯',                     label: 'R1  throttled',     expectInject: false, expectReason: 'throttled' },
    { token, round: 2, prevStage: 'daily', text: '哦',                     label: 'R2  throttled',     expectInject: false, expectReason: 'throttled' },
    { token, round: 3, prevStage: 'daily', text: '继续',                   label: 'R3  throttled',     expectInject: false, expectReason: 'throttled' },
    { token, round: 4, prevStage: 'daily', text: '说说看',                 label: 'R4  elapsed',       expectInject: true,  expectReason: 'throttle-elapsed' },
    { token, round: 5, prevStage: 'daily', text: '嗯嗯',                   label: 'R5  throttled',     expectInject: false, expectReason: 'throttled' },
    { token, round: 6, prevStage: 'daily', text: '我们关系走到哪一步了',   label: 'R6  keyword',       expectInject: true,  expectReason: 'keyword' },
    { token, round: 7, prevStage: 'daily', text: '随便',                   label: 'R7  throttled',     expectInject: false, expectReason: 'throttled' },
    // 客户端缓存的 prevStage 与 judgeStage 算出的 curStage 不同 → stage-change
    { token, round: 8, prevStage: 'rise',  text: '看看',                   label: 'R8  stage-change',  expectInject: true,  expectReason: 'stage-change' },
    { token, round: 9, prevStage: 'daily', text: '好的',                   label: 'R9  throttled',     expectInject: false, expectReason: 'throttled' },
  ];

  const results: Array<{ round: number; label: string; expectInject: boolean; expectReason: string }> = [];
  for (const p of plan) results.push(await sendRound(p));

  console.log('\n\n████████ 10 轮计划 vs 期望 ████████');
  for (const r of results) {
    console.log(`  ${r.label.padEnd(22)} | expect inject=${String(r.expectInject).padEnd(5)} reason=${r.expectReason}`);
  }
  console.log('\n（请对照上方 [memory-gate] / [debug-system-prompt] 日志核验）');
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
