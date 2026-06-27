// 探针：跑 flag=off + flag=on 两组对话，打印发包/收包/网关日志/session 状态
// 用法：pnpm --filter @yelan/api exec tsx scripts/probe-memory-gate.ts
import { store } from '../src/store/persistence';
import { clearFlagCache } from '../src/config/feature-flags';
import { mockChatRoute } from '../src/routes/chat';

function setup() {
  store.__resetForTests();
  const userId = 'usr_probe';
  const token = 'tok_probe';
  store.state().users[userId] = {
    id: userId,
    phone: '13800001111',
    token,
    ageVerified: true,
    narrativeBoundary: 2,
    ifUnlocked: false,
    createdAt: new Date().toISOString(),
    candle: 100,
    registerGrant: 100,
  };
  store.state().tokenIndex[token] = userId;
  store.state().phoneIndex['13800001111'] = userId;
  store.state().characters['probe-char'] = {
    id: 'probe-char',
    slug: 'probe',
    name: '夜阑',
    rarity: 'free',
    priceCandle: 0,
    styleTags: [],
    boundaryDefault: 2,
    isActive: true,
    openingFirstVisit: '你来了。',
    openingReturnVisit: '又见面了。',
    forbiddenPhrases: [],
    description: '冷静克制',
    updatedAt: new Date().toISOString(),
  };
  store.save();
  return { userId, token };
}

interface RoundOpts {
  token: string;
  sessionId: string;
  round: number;
  prevStage: 'daily' | 'rise' | 'climax' | 'after' | 'end';
  text: string;
  recall?: { preferences: string[]; events: { date: string; text: string; emotion?: string }[] };
}

async function sendRound(opts: RoundOpts) {
  const body = {
    characterId: 'probe-char',
    sessionId: opts.sessionId,
    round: opts.round,
    prevStage: opts.prevStage,
    userBoundary: 2,
    text: opts.text,
    history: [],
    recall: opts.recall ?? { preferences: ['用户偏好测试1'], events: [{ date: '今天', text: '事件测试', emotion: '平静' }] },
  };

  console.log('\n┌─── 发包 ───');
  console.log('│ POST /api/chat');
  console.log('│ body =', JSON.stringify(body, null, 2).split('\n').map(l => '│   ' + l).join('\n').slice(4));
  console.log('└─────────────');

  const res = await mockChatRoute.request('/', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.token}`,
      Accept: 'text/event-stream',
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  const events = text
    .split('\n\n')
    .filter((b) => b.startsWith('data:'))
    .map((b) => {
      try {
        return JSON.parse(b.slice(5).trim());
      } catch {
        return { raw: b };
      }
    });

  console.log('┌─── 收包 (SSE events) ───');
  for (const ev of events) {
    const kind = (ev as { kind?: string }).kind ?? '?';
    let summary = '';
    if (kind === 'meta') summary = `stage=${ev.stage} boundary=${ev.boundary} llmMode=${ev.llmMode}`;
    else if (kind === 'atmosphere') summary = `temperature=${ev.temperature}`;
    else if (kind === 'chunk') summary = `text=${JSON.stringify(ev.text)}`;
    else if (kind === 'structured') summary = `parts=${ev.parts?.length ?? 0} (rawText ${ev.rawText?.length ?? 0}b)`;
    else if (kind === 'done') summary = '';
    else summary = JSON.stringify(ev).slice(0, 120);
    console.log(`│   [${kind}] ${summary}`);
  }
  console.log('└──────────────────────────');

  const sess = store.state().sessions[opts.sessionId];
  console.log(`session.lastMemoryRound = ${sess?.lastMemoryRound === undefined ? 'undefined' : sess.lastMemoryRound}, round = ${sess?.round}, prevStage = ${sess?.prevStage}`);
}

async function main() {
  const { token } = setup();

  console.log('\n████████ Scenario A: flag = OFF (baseline) ████████');
  delete process.env.FEATURE_MEMORY_THROTTLE;
  clearFlagCache();

  await sendRound({ token, sessionId: 'sess_A', round: 0, prevStage: 'daily', text: '你好' });
  await sendRound({ token, sessionId: 'sess_A', round: 1, prevStage: 'daily', text: '嗯' });

  console.log('\n████████ Scenario B: flag = ON, 同 stage 节流 ████████');
  process.env.FEATURE_MEMORY_THROTTLE = 'on';
  clearFlagCache();

  await sendRound({ token, sessionId: 'sess_B', round: 0, prevStage: 'daily', text: '你好' });
  await sendRound({ token, sessionId: 'sess_B', round: 1, prevStage: 'daily', text: '嗯' });
  await sendRound({ token, sessionId: 'sess_B', round: 2, prevStage: 'daily', text: '随便看看' });

  console.log('\n████████ Scenario C: flag = ON, 关键词 override ████████');
  await sendRound({ token, sessionId: 'sess_C', round: 0, prevStage: 'daily', text: '你好' });
  await sendRound({ token, sessionId: 'sess_C', round: 1, prevStage: 'daily', text: '我们关系走到哪一步了' });

  console.log('\n████████ Scenario D: flag = ON, 4 轮节流到期 ████████');
  await sendRound({ token, sessionId: 'sess_D', round: 0, prevStage: 'daily', text: '你好' });
  await sendRound({ token, sessionId: 'sess_D', round: 1, prevStage: 'daily', text: '嗯' });
  await sendRound({ token, sessionId: 'sess_D', round: 2, prevStage: 'daily', text: '哦' });
  await sendRound({ token, sessionId: 'sess_D', round: 3, prevStage: 'daily', text: '好' });
  await sendRound({ token, sessionId: 'sess_D', round: 4, prevStage: 'daily', text: '继续' });

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
