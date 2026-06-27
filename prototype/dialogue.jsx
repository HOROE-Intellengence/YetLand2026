// Scripted dialogue for "旧友重逢, 言语试探" — fake AI with keyword branching.
// Each turn: { ai: [paragraphs], match: [{kw: [...], reply: [...]}], default: [...] }

const DIALOGUE_OPENING = [
  "雨是从你推门的那一刻开始下的。",
  "他坐在靠窗那张老位子，抬起头，停顿了半秒——",
  "「……三年了。」",
  "他说，声音比记忆里更哑一些。",
];

// Keyword branches. Each user input is matched against `kw`; first match wins.
// `reply` is an array of paragraphs (句级浮现). `glow` flags a "breathing" key sentence.
// `achievement` triggers a flash. `stage` shifts narrative mode.
const SCRIPT = [
  // Turn 1 — opening response
  {
    branches: [
      {
        kw: ['好久不见', '你好', '嗨', '嘿'],
        reply: [
          "他笑了一下，眼睛却没笑。",
          { text: "「好久不见。」", glow: true },
          "他把面前那杯凉透的茶推到你面前，像三年前你常做的那样。",
        ],
      },
      {
        kw: ['你', '怎么', '在这', '为什么'],
        reply: [
          "「我？」他偏过头，看向窗外的雨，「我每个礼拜三都来这里。」",
          { text: "「我以为，你总有一天会推门进来。」", glow: true },
          "桌上那盏台灯轻轻颤了一下。",
        ],
        achievement: { name: '执念', desc: '他等了你一百五十六个礼拜三' },
      },
      {
        kw: ['对不起', '抱歉'],
        reply: [
          "他没立刻回答。",
          "茶杯在他指间转了半圈。",
          "「别说那个词。」他终于开口，「说了，三年就白等了。」",
        ],
      },
    ],
    default: [
      "他没有催你。",
      "雨声在玻璃上慢慢爬。",
      "他只是看着你，像是在确认你不是一个梦。",
    ],
  },
  // Turn 2
  {
    branches: [
      {
        kw: ['想', '念', '记得', '一直'],
        reply: [
          "他怔了一下。",
          { text: "「我也是。」", glow: true },
          "那两个字落得很轻，像怕被雨声盖过去。",
          "他低下头，去看自己的手——你忽然发现，他左手无名指上什么也没有。",
        ],
        stage: 'rise',
      },
      {
        kw: ['结婚', '老婆', '家'],
        reply: [
          "「没有。」他说得很平静。",
          "「差一点。后来发现，差的那一点，是你。」",
        ],
        stage: 'rise',
        glow: true,
      },
      {
        kw: ['走', '离开', '回去'],
        reply: [
          "「再坐一会儿。」他说。",
          "不是请求的语气，也不是命令——",
          { text: "是一种他三年没说出口、终于在今天说出口的、克制的渴望。", glow: true },
        ],
        stage: 'rise',
      },
      {
        kw: ['喜欢', '爱', '想你'],
        reply: [
          "他抬眼，那目光比窗外的雨还要沉。",
          { text: "「这话你三年前没说。」", glow: true },
          "「现在说……」他顿了顿，「会不会太晚？」",
        ],
        achievement: { name: '告白', desc: '有些字，迟了三年才落地' },
        stage: 'rise',
      },
    ],
    default: [
      "他没说话，只是把那杯茶又往你这边推了推。",
      "杯壁是温的。",
      "你才意识到——他点这杯，是在等你。",
    ],
  },
  // Turn 3 — climax / intimacy rises
  {
    branches: [
      {
        kw: ['手', '碰', '握', '靠近'],
        reply: [
          "他的手翻过来，掌心朝上，停在桌面正中。",
          "没说话。",
          { text: "雨更大了。整间店只剩你们两个人的呼吸。", glow: true },
        ],
        stage: 'climax',
      },
      {
        kw: ['现在', '今晚', '今天', '别走'],
        reply: [
          "他笑了，像哭一样地笑了一下。",
          { text: "「那我今晚……不走了。」", glow: true },
          "他说这话的时候，没看你。",
          "可桌下，他的脚轻轻碰到了你的。",
        ],
        stage: 'climax',
      },
    ],
    default: [
      "他凝视你的时间，长得像一段没说完的话。",
      "店里的暖灯，把他眼睛染成了茶色。",
    ],
    stage: 'climax',
  },
  // Turn 4 — the cutoff approaches
  {
    branches: [
      {
        kw: ['*'],
        reply: [
          "他终于伸出手，越过桌面，落在你的手背上。",
          "指尖是凉的，但很快就暖了。",
          { text: "窗外的雨像是从很远的地方传来。", glow: true },
        ],
        stage: 'climax',
      },
    ],
    default: [
      "他终于伸出手，越过桌面，落在你的手背上。",
      { text: "指尖是凉的，但很快就暖了。", glow: true },
    ],
    stage: 'climax',
  },
];

// match user input → branch index in SCRIPT[turn].branches, or -1 for default
function matchBranch(turn, input) {
  if (turn >= SCRIPT.length) return { idx: -1, branch: null };
  const t = SCRIPT[turn];
  const lower = (input || '').trim();
  for (let i = 0; i < t.branches.length; i++) {
    const b = t.branches[i];
    for (const kw of b.kw) {
      if (kw === '*' || lower.includes(kw)) {
        return { idx: i, branch: b };
      }
    }
  }
  return { idx: -1, branch: null };
}

window.DIALOGUE_OPENING = DIALOGUE_OPENING;
window.SCRIPT = SCRIPT;
window.matchBranch = matchBranch;
