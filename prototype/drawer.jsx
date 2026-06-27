// Drawer — the structured back-of-house surfaces per 开发文档 §四
// 你 (profile) · 续夜 (subscription) · 烛账 (candle ledger) · 书阁 (library)
// 记事 (memory) · 印 (achievements) · 调息 (settings) · 一问 (survey)
//
// Visual contract: same暖羊皮纸 / 暗金 / serif palette as the conversation;
// drawer slides in from the right, content uses the same prose width and breath.

const { useState: uS, useEffect: uE, useRef: uR, useMemo: uM } = React;

// ---------- ledger / data placeholders ----------
const CANDLE_LEDGER = [
  { d: '今夜·02:14', delta: +30, reason: '告白 · 成就', tag: 'achievement' },
  { d: '今夜·01:48', delta: +5,  reason: '雨夜的一句问好',     tag: 'daily_greeting' },
  { d: '昨夜·23:02', delta: -50, reason: '解锁 · 「青衣」',     tag: 'unlock_card' },
  { d: '昨夜·22:30', delta: +12, reason: '好感 · 旧识浮现',     tag: 'favor_trigger' },
  { d: '前夜·00:55', delta: +50, reason: '深夜 · 成就',         tag: 'achievement' },
  { d: '初夜·19:00', delta: +200, reason: '注册时点的第一支烛', tag: 'register_grant' },
];

const ACHIEVEMENTS = [
  { id: 'zhinian', name: '执　念', cond: '连续五轮，未曾别开眼',     unlocked: true,  ts: '今夜' },
  { id: 'gaobai', name: '告　白', cond: '说出那个字',                unlocked: true,  ts: '今夜' },
  { id: 'jiushi', name: '旧　识', cond: '他记得你三日前说过的话',     unlocked: false },
  { id: 'shenye', name: '深　夜', cond: '在零点与四点之间，与他相对', unlocked: true,  ts: '前夜' },
  { id: 'libie', name: '离　别', cond: '七日不见，再推门时',         unlocked: false },
];

const LIBRARY = [
  { id: 'gu',   name: '顾　远', tag: '现代 · 克制',   unlocked: true,  cost: 0,   line: '雨夜书店里，他坐了三年的同一把椅子。' },
  { id: 'ji',   name: '季　南', tag: '现代 · 推拉',   unlocked: true,  cost: 0,   line: '便利店的霓虹灯坏了一支，他没修。' },
  { id: 'qing', name: '青　衣', tag: '古风 · 含蓄',   unlocked: true,  cost: 50,  line: '江南的雨，下在三百年前。' },
  { id: 'xun',  name: '洵',     tag: '古风 · 病娇',   unlocked: false, cost: 80,  line: '——尚未相遇。' },
  { id: 'mu',   name: '慕白', tag: '现代 · 年下',   unlocked: false, cost: 120, line: '——尚未相遇。' },
  { id: 'wu',   name: '?　?',   tag: '???',           unlocked: false, cost: 0,   line: '门后有声音，但还没开。' },
];

const MEMORY = [
  { type: 'pref',  text: '不喜欢被叫"宝贝"。',        when: '今夜', char: '顾远' },
  { type: 'pref',  text: '雨天容易心软。',              when: '今夜', char: '顾远' },
  { type: 'event', text: '提起三年前那把伞。',           when: '今夜', char: '顾远' },
  { type: 'event', text: '问起他左手无名指。',           when: '今夜', char: '顾远' },
  { type: 'pref',  text: '喜欢便利店关东煮里的萝卜。',   when: '前夜', char: '季南' },
  { type: 'event', text: '提到弟弟出事的那年。',         when: '前夜', char: '季南' },
];

const PLANS = [
  { id: 'moonlight', name: '月　光', tagline: '每周一晚，月光陪你', priceWeek: '¥9.9', priceMonth: '¥29.9', tokens: '200 烛 / 月', desc: '每日对话不限轮次，叙事完整流畅。' },
  { id: 'milkyway',  name: '星　河', tagline: '每个夜晚，星光随行', priceWeek: '¥19.9', priceMonth: '¥59.9', tokens: '600 烛 / 月', desc: '无限对话 · 优先叙事引擎 · 高级角色卡池。' },
  { id: 'eternal',   name: '永　夜', tagline: '永远为你亮着',         priceWeek: '¥39.9', priceMonth: '¥99.9', tokens: '1500 烛 / 月', desc: '无限对话 · 全部角色卡 · 后续优先体验。' },
];

// ---------- shared atoms ----------
function Heading({ num, label, sub }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{ fontSize: 'calc(10px * var(--type-scale))', letterSpacing: 4, color: 'var(--paper-mute)', fontFamily: 'Inter, sans-serif', marginBottom: 8 }}>
        {num}
      </div>
      <div style={{ fontSize: 'calc(22px * var(--type-scale))', color: 'var(--gold-light)', letterSpacing: 6, fontWeight: 400, marginBottom: sub ? 6 : 0 }}>
        {label}
      </div>
      {sub && (
        <div style={{ fontSize: 'calc(12px * var(--type-scale))', color: 'var(--paper-dim)', letterSpacing: 1, fontStyle: 'italic', lineHeight: 1.8 }}>
          {sub}
        </div>
      )}
    </div>
  );
}

function Divider() {
  return <div style={{ height: 1, margin: '24px 0', background: 'linear-gradient(to right, transparent, rgba(160,128,96,0.25), transparent)' }} />;
}

function FaintRow({ left, right, hl }) {
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'baseline',
      padding: '12px 0', borderBottom: '0.5px solid rgba(160,128,96,0.10)',
      fontSize: 'calc(13px * var(--type-scale))',
    }}>
      <span style={{ color: hl ? 'var(--paper)' : 'var(--paper-dim)', letterSpacing: 0.5 }}>{left}</span>
      <span style={{ color: hl ? 'var(--gold-light)' : 'var(--paper-mute)', fontFamily: 'Inter, sans-serif', fontSize: 'calc(12px * var(--type-scale))', letterSpacing: 1 }}>{right}</span>
    </div>
  );
}

// ---------- Drawer rail (always-visible bottom-left vertical tabs) ----------
const RAIL_ITEMS = [
  { id: 'you',     label: '你',   en: 'YOU'      },
  { id: 'subs',    label: '续夜', en: 'NIGHT'    },
  { id: 'candle',  label: '烛账', en: 'CANDLES'  },
  { id: 'library', label: '书阁', en: 'LIBRARY'  },
  { id: 'memory',  label: '记事', en: 'MEMORY'   },
  { id: 'seal',    label: '印',   en: 'SEAL'     },
  { id: 'survey',  label: '一问', en: 'ASK'      },
  { id: 'breath',  label: '调息', en: 'BREATH'   },
];

function DrawerRail({ open, onOpen }) {
  const [hover, setHover] = uS(null);
  return (
    <div style={{
      position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)',
      zIndex: 8,
      opacity: open ? 0 : 1, pointerEvents: open ? 'none' : 'auto',
      transition: 'opacity 0.7s ease',
    }}>
      {/* faint vertical guide */}
      <div style={{
        position: 'absolute', left: 0, top: 12, bottom: 12,
        width: 1, background: 'linear-gradient(180deg, transparent 0%, rgba(160,128,96,0.18) 20%, rgba(160,128,96,0.18) 80%, transparent 100%)',
      }} />

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {RAIL_ITEMS.map((it, i) => {
          const isHover = hover === it.id;
          return (
            <button
              key={it.id}
              onClick={() => onOpen(it.id)}
              onMouseEnter={() => setHover(it.id)}
              onMouseLeave={() => setHover(null)}
              style={{
                background: isHover ? 'linear-gradient(90deg, rgba(220,188,130,0.10) 0%, rgba(220,188,130,0) 100%)' : 'transparent',
                border: 'none',
                borderLeft: '2px solid',
                borderLeftColor: isHover ? 'var(--gold-light)' : 'rgba(160,128,96,0.28)',
                color: isHover ? 'var(--gold-light)' : 'var(--paper-dim)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                padding: '14px 22px 14px 18px',
                textAlign: 'left',
                fontWeight: 300,
                transition: 'all 0.45s ease',
                display: 'flex', flexDirection: 'column', gap: 4,
                minWidth: 96,
              }}
            >
              <span style={{
                fontSize: 'calc(9px * var(--type-scale))',
                letterSpacing: 3,
                fontFamily: 'Inter, sans-serif',
                color: isHover ? 'rgba(220,188,130,0.7)' : 'var(--paper-mute)',
                transition: 'color 0.45s ease',
              }}>
                {String(i + 1).padStart(2, '0')} · {it.en}
              </span>
              <span style={{
                fontSize: 'calc(15px * var(--type-scale))',
                letterSpacing: isHover ? 8 : 5,
                transition: 'letter-spacing 0.45s ease',
              }}>
                {it.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* tiny hint at top */}
      <div style={{
        position: 'absolute', left: 18, top: -28,
        fontSize: 'calc(9px * var(--type-scale))', letterSpacing: 4,
        color: 'var(--paper-mute)', fontFamily: 'Inter, sans-serif',
        opacity: 0.55,
      }}>
        — 抽　屉 —
      </div>
    </div>
  );
}

// ---------- Panel shell ----------
function DrawerShell({ openId, onClose, candle, onCandleChange, narrativeBoundary, onBoundaryChange }) {
  const open = !!openId;
  const [tab, setTab] = uS(openId);
  uE(() => { if (openId) setTab(openId); }, [openId]);

  return (
    <>
      {/* scrim */}
      <div
        onClick={onClose}
        style={{
          position: 'absolute', inset: 0, zIndex: 9,
          background: 'rgba(4, 4, 8, 0.55)', backdropFilter: 'blur(2px)',
          opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.7s ease',
        }}
      />
      {/* drawer */}
      <aside style={{
        position: 'absolute', top: 0, right: 0, bottom: 0,
        width: 'min(560px, 92vw)', zIndex: 10,
        background: 'linear-gradient(180deg, #0c0c12 0%, #0a0a0f 60%)',
        borderLeft: '0.5px solid rgba(160,128,96,0.18)',
        boxShadow: '-40px 0 80px -20px rgba(0,0,0,0.6)',
        transform: open ? 'translateX(0)' : 'translateX(102%)',
        transition: 'transform 0.85s cubic-bezier(.2,.7,.2,1)',
        display: 'flex', flexDirection: 'column',
        overflow: 'hidden',
      }}>
        {/* header */}
        <div style={{
          padding: '24px 36px 18px', display: 'flex',
          alignItems: 'center', justifyContent: 'space-between',
          borderBottom: '0.5px solid rgba(160,128,96,0.12)',
        }}>
          <div style={{ fontSize: 'calc(11px * var(--type-scale))', letterSpacing: 5, color: 'var(--paper-mute)', fontFamily: 'Inter, sans-serif' }}>
            YELAN · 抽　屉
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--paper-dim)', fontFamily: 'inherit',
              fontSize: 'calc(12px * var(--type-scale))', letterSpacing: 4,
            }}
          >
            合　上
          </button>
        </div>

        {/* tabs */}
        <div style={{
          display: 'flex', gap: 0, padding: '12px 24px',
          borderBottom: '0.5px solid rgba(160,128,96,0.10)',
          overflowX: 'auto', scrollbarWidth: 'none',
        }}>
          {RAIL_ITEMS.map(it => (
            <button
              key={it.id}
              onClick={() => setTab(it.id)}
              style={{
                background: 'transparent', border: 'none',
                fontFamily: 'inherit', cursor: 'pointer',
                padding: '8px 14px', fontSize: 'calc(13px * var(--type-scale))', letterSpacing: 3,
                color: tab === it.id ? 'var(--gold-light)' : 'var(--paper-mute)',
                fontWeight: 300,
                position: 'relative',
                transition: 'color 0.4s ease',
                whiteSpace: 'nowrap',
              }}
            >
              {it.label}
              {tab === it.id && (
                <span style={{
                  position: 'absolute', left: '20%', right: '20%', bottom: 0,
                  height: 1, background: 'var(--gold-light)',
                  boxShadow: '0 0 8px rgba(220,188,130,0.8)',
                }} />
              )}
            </button>
          ))}
        </div>

        {/* body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '36px 44px 60px' }}>
          {tab === 'you'     && <PaneYou candle={candle} />}
          {tab === 'subs'    && <PaneSubs />}
          {tab === 'candle'  && <PaneCandle candle={candle} onCandleChange={onCandleChange} />}
          {tab === 'library' && <PaneLibrary />}
          {tab === 'memory'  && <PaneMemory />}
          {tab === 'seal'    && <PaneSeal />}
          {tab === 'survey'  && <PaneSurvey />}
          {tab === 'breath'  && <PaneBreath narrativeBoundary={narrativeBoundary} onBoundaryChange={onBoundaryChange} />}
        </div>
      </aside>
    </>
  );
}

// ---------- 你 · profile / arc ----------
function PaneYou({ candle }) {
  const candleLabel = candle === 'low' ? '将　尽' : candle === 'mid' ? '渐　晚' : '充　盈';
  const candleColor = candle === 'low' ? 'rgba(220,100,80,0.9)'
                   : candle === 'mid' ? 'rgba(220,170,90,0.9)'
                   : 'rgba(180,220,160,0.9)';
  return (
    <div>
      <Heading num="01 / 你" label="今　夜" sub="一本围着你写的小说，从你推门那一刻起。" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginBottom: 24 }}>
        <Card label="你的称呼" big="今夜的人" sub="每次启程时重新述说" />
        <Card label="结伴角色" big="顾　远" sub="现代 · 克制 · 推拉" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 28 }}>
        <Stat label="本周轮次" value="14 / 20" hint="免费叙事弧" />
        <Stat label="共度夜晚" value="3" hint="自首次推门" />
        <Stat label="烛光" value={candleLabel} dotColor={candleColor} />
      </div>
      <Heading num="02 / 弧" label="今　日　叙　事　弧" />
      <ArcLine />
      <p style={{ fontSize: 'calc(13px * var(--type-scale))', color: 'var(--paper-dim)', lineHeight: 2, marginTop: 20, fontStyle: 'italic' }}>
        当夜未尽时，故事会自然走向一个悬念点；
        天将明，他不会硬留你。
      </p>
    </div>
  );
}

function Card({ label, big, sub }) {
  return (
    <div style={{
      border: '0.5px solid rgba(160,128,96,0.18)',
      padding: '16px 18px', borderRadius: 4,
      background: 'rgba(255,255,255,0.012)',
    }}>
      <div style={{ fontSize: 'calc(10px * var(--type-scale))', letterSpacing: 3, color: 'var(--paper-mute)', fontFamily: 'Inter, sans-serif', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontSize: 'calc(18px * var(--type-scale))', color: 'var(--paper)', letterSpacing: 3, fontWeight: 400, marginBottom: 6 }}>
        {big}
      </div>
      <div style={{ fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-dim)', letterSpacing: 1, fontStyle: 'italic' }}>
        {sub}
      </div>
    </div>
  );
}

function Stat({ label, value, hint, dotColor }) {
  return (
    <div style={{ borderTop: '0.5px solid rgba(160,128,96,0.18)', paddingTop: 12 }}>
      <div style={{ fontSize: 'calc(10px * var(--type-scale))', letterSpacing: 2, color: 'var(--paper-mute)', fontFamily: 'Inter, sans-serif', marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        {dotColor && (
          <span style={{
            width: 6, height: 6, borderRadius: 3, background: dotColor,
            boxShadow: `0 0 10px ${dotColor}`,
          }} />
        )}
        <div style={{ fontSize: 'calc(17px * var(--type-scale))', color: 'var(--gold-light)', letterSpacing: 2, fontWeight: 300 }}>
          {value}
        </div>
      </div>
      {hint && (
        <div style={{ fontSize: 'calc(10px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 1, fontFamily: 'Inter, sans-serif' }}>
          {hint}
        </div>
      )}
    </div>
  );
}

function ArcLine() {
  const arc = [
    { stage: '日常', pct: 0.20, on: true },
    { stage: '推拉', pct: 0.45, on: true },
    { stage: '高潮', pct: 0.75, on: true },
    { stage: '余韵', pct: 1.0,  on: false },
  ];
  return (
    <div style={{ position: 'relative', height: 90, padding: '20px 0' }}>
      {/* base line */}
      <div style={{
        position: 'absolute', top: '50%', left: 0, right: 0, height: 0.5,
        background: 'rgba(160,128,96,0.25)',
      }} />
      {/* glow segment */}
      <div style={{
        position: 'absolute', top: '50%', left: 0, height: 0.5, width: '70%',
        background: 'linear-gradient(to right, rgba(160,128,96,0.4), rgba(220,188,130,0.85), rgba(208,76,60,0.6))',
        boxShadow: '0 0 12px rgba(220,188,130,0.5)',
      }} />
      {arc.map((s, i) => (
        <div key={s.stage} style={{
          position: 'absolute', top: '50%', left: `${s.pct * 100 - 1}%`,
          transform: 'translate(-50%, -50%)',
          textAlign: 'center',
        }}>
          <div style={{
            width: s.on ? 9 : 5, height: s.on ? 9 : 5, borderRadius: 5,
            background: s.on ? 'rgba(232,168,84,1)' : 'rgba(160,128,96,0.3)',
            boxShadow: s.on ? '0 0 14px rgba(232,168,84,0.8)' : 'none',
            margin: '0 auto',
          }} />
          <div style={{
            position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)',
            fontSize: 'calc(11px * var(--type-scale))', color: s.on ? 'var(--paper)' : 'var(--paper-mute)',
            letterSpacing: 3, whiteSpace: 'nowrap', marginTop: 4,
          }}>
            {s.stage}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- 续夜 · subscription ----------
function PaneSubs() {
  const [hover, setHover] = uS(null);
  const [cycle, setCycle] = uS('month');
  return (
    <div>
      <Heading num="01 / 续夜" label="夜　未　央" sub="不是充值，是续住。" />
      <div style={{
        display: 'inline-flex', gap: 0, padding: 3,
        border: '0.5px solid rgba(160,128,96,0.2)', borderRadius: 24,
        marginBottom: 28,
      }}>
        {[['week', '一周'], ['month', '一月']].map(([k, l]) => (
          <button key={k}
            onClick={() => setCycle(k)}
            style={{
              background: cycle === k ? 'rgba(160,128,96,0.18)' : 'transparent',
              border: 'none', color: cycle === k ? 'var(--gold-light)' : 'var(--paper-mute)',
              fontFamily: 'inherit', fontSize: 'calc(12px * var(--type-scale))', letterSpacing: 3,
              padding: '6px 18px', borderRadius: 20, cursor: 'pointer',
              transition: 'all 0.5s ease',
            }}>
            {l}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {PLANS.map(p => (
          <div key={p.id}
            onMouseEnter={() => setHover(p.id)}
            onMouseLeave={() => setHover(null)}
            style={{
              border: '0.5px solid',
              borderColor: hover === p.id ? 'rgba(220,188,130,0.55)' : 'rgba(160,128,96,0.2)',
              padding: '20px 22px', borderRadius: 6,
              background: hover === p.id ? 'rgba(220,188,130,0.03)' : 'rgba(255,255,255,0.01)',
              cursor: 'pointer',
              transition: 'all 0.6s ease',
              boxShadow: hover === p.id ? '0 0 32px -8px rgba(220,188,130,0.4)' : 'none',
              display: 'flex', flexDirection: 'column', gap: 10,
            }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div>
                <div style={{ fontSize: 'calc(18px * var(--type-scale))', color: 'var(--gold-light)', letterSpacing: 6, fontWeight: 400 }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 'calc(12px * var(--type-scale))', color: 'var(--paper-dim)', fontStyle: 'italic', marginTop: 4, letterSpacing: 1 }}>
                  {p.tagline}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 'calc(22px * var(--type-scale))', color: 'var(--paper)', fontWeight: 300, fontFamily: 'Inter, sans-serif' }}>
                  {cycle === 'week' ? p.priceWeek : p.priceMonth}
                </div>
                <div style={{ fontSize: 'calc(10px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 2, fontFamily: 'Inter, sans-serif' }}>
                  {cycle === 'week' ? '/ WEEK' : '/ MONTH'}
                </div>
              </div>
            </div>
            <div style={{ fontSize: 'calc(13px * var(--type-scale))', color: 'var(--paper-dim)', lineHeight: 1.9, letterSpacing: 0.5 }}>
              {p.desc}
            </div>
            <div style={{
              fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 2,
              fontFamily: 'Inter, sans-serif', borderTop: '0.5px solid rgba(160,128,96,0.12)',
              paddingTop: 10,
            }}>
              赠 · {p.tokens}
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 1, marginTop: 24, lineHeight: 1.9, fontStyle: 'italic' }}>
        我们不写"立即开通"。你按下时，是借宿一晚，还是租下一整月，自己知道就好。
      </p>
    </div>
  );
}

// ---------- 烛账 · candle ledger ----------
function PaneCandle({ candle, onCandleChange }) {
  const balance = candle === 'low' ? 18 : candle === 'mid' ? 84 : 247;
  const candleLabel = candle === 'low' ? '将尽' : candle === 'mid' ? '渐晚' : '充盈';
  const dot = candle === 'low' ? 'rgba(220,100,80,0.9)' : candle === 'mid' ? 'rgba(220,170,90,0.9)' : 'rgba(180,220,160,0.9)';
  return (
    <div>
      <Heading num="01 / 烛账" label="一　支　烛" sub="只看光，不数数。" />
      {/* candle visual */}
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        padding: '40px 0 30px',
        borderBottom: '0.5px solid rgba(160,128,96,0.12)', marginBottom: 24,
      }}>
        <div style={{ position: 'relative', height: 120, width: 30, marginBottom: 14 }}>
          {/* candle body */}
          <div style={{
            position: 'absolute', bottom: 0, left: '50%',
            transform: 'translateX(-50%)',
            width: 16, height: 90,
            background: 'linear-gradient(to top, rgba(200,184,164,0.08), rgba(200,184,164,0.18))',
            borderRadius: '2px 2px 1px 1px',
            border: '0.5px solid rgba(160,128,96,0.25)',
          }} />
          {/* wick */}
          <div style={{
            position: 'absolute', bottom: 88, left: '50%',
            transform: 'translateX(-50%)',
            width: 0.6, height: 6, background: 'rgba(60,40,30,0.7)',
          }} />
          {/* flame */}
          <div style={{
            position: 'absolute', bottom: 92, left: '50%',
            transform: 'translateX(-50%)',
            width: 8, height: 8, borderRadius: 4,
            background: dot,
            boxShadow: `0 0 16px ${dot}, 0 0 36px ${dot}`,
            animation: candle === 'low' ? 'candleLow 1.4s ease-in-out infinite'
                    : candle === 'mid' ? 'candleMid 2.2s ease-in-out infinite'
                    : 'candleFull 4s ease-in-out infinite',
          }} />
        </div>
        <div style={{ fontSize: 'calc(14px * var(--type-scale))', letterSpacing: 5, color: 'var(--gold-light)', marginBottom: 4 }}>
          {candleLabel}
        </div>
        <div style={{ fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 2, fontFamily: 'Inter, sans-serif' }}>
          {balance} 余
        </div>
      </div>
      {/* ledger */}
      <div style={{ fontSize: 'calc(11px * var(--type-scale))', letterSpacing: 4, color: 'var(--paper-mute)', fontFamily: 'Inter, sans-serif', marginBottom: 12 }}>
        近来的进出
      </div>
      {CANDLE_LEDGER.map((row, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'baseline',
          padding: '12px 0',
          borderBottom: '0.5px solid rgba(160,128,96,0.08)',
        }}>
          <div style={{
            width: 70, fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)',
            fontFamily: 'Inter, sans-serif', letterSpacing: 1,
          }}>
            {row.d}
          </div>
          <div style={{ flex: 1, fontSize: 'calc(13px * var(--type-scale))', color: 'var(--paper-dim)', letterSpacing: 0.5 }}>
            {row.reason}
          </div>
          <div style={{
            fontSize: 'calc(14px * var(--type-scale))', fontFamily: 'Inter, sans-serif',
            color: row.delta > 0 ? 'rgba(180,220,160,0.85)' : 'rgba(220,140,110,0.8)',
            fontWeight: 300, letterSpacing: 0.5,
          }}>
            {row.delta > 0 ? '+' : ''}{row.delta}
          </div>
        </div>
      ))}
      <p style={{ fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 1, marginTop: 22, lineHeight: 1.9, fontStyle: 'italic' }}>
        烛会因好感、深夜、问卷而生；为解锁某扇门而少。
      </p>
    </div>
  );
}

// ---------- 书阁 · library ----------
function PaneLibrary() {
  return (
    <div>
      <Heading num="01 / 书阁" label="门　与　门" sub="书阁里的人，有的等你，有的还没遇见。" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {LIBRARY.map(c => (
          <DoorCard key={c.id} c={c} />
        ))}
      </div>
      <p style={{ fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 1, marginTop: 22, lineHeight: 1.9, fontStyle: 'italic' }}>
        书阁不卖故事。你只是借一支烛，把某扇门照亮。
      </p>
    </div>
  );
}

function DoorCard({ c }) {
  const [hover, setHover] = uS(false);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        position: 'relative',
        border: '0.5px solid',
        borderColor: c.unlocked ? (hover ? 'rgba(220,188,130,0.5)' : 'rgba(160,128,96,0.22)')
                                : 'rgba(120,108,88,0.18)',
        padding: '20px 18px', borderRadius: 4,
        background: c.unlocked
          ? (hover ? 'rgba(220,188,130,0.04)' : 'rgba(255,255,255,0.012)')
          : 'rgba(0,0,0,0.18)',
        minHeight: 130,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        cursor: c.unlocked ? 'default' : 'pointer',
        transition: 'all 0.6s ease',
        opacity: c.unlocked ? 1 : 0.6,
      }}
    >
      <div>
        <div style={{
          fontSize: 'calc(18px * var(--type-scale))', fontWeight: 400, letterSpacing: 4,
          color: c.unlocked ? (hover ? 'var(--gold-light)' : 'var(--paper)') : 'var(--paper-mute)',
          marginBottom: 6, transition: 'color 0.5s ease',
        }}>
          {c.name}
        </div>
        <div style={{ fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 2, fontFamily: 'Inter, sans-serif', marginBottom: 10 }}>
          {c.tag}
        </div>
        <div style={{ fontSize: 'calc(12px * var(--type-scale))', color: 'var(--paper-dim)', lineHeight: 1.8, fontStyle: 'italic', letterSpacing: 0.5 }}>
          {c.line}
        </div>
      </div>
      <div style={{
        marginTop: 14, fontSize: 'calc(11px * var(--type-scale))', letterSpacing: 2,
        color: c.unlocked ? 'var(--paper-mute)' : 'var(--gold-light)',
        fontFamily: 'Inter, sans-serif',
        borderTop: '0.5px solid rgba(160,128,96,0.12)', paddingTop: 10,
      }}>
        {c.unlocked ? '已　相　识' : `${c.cost} 烛 · 借　光`}
      </div>
    </div>
  );
}

// ---------- 记事 · memory ----------
function PaneMemory() {
  const [confirm, setConfirm] = uS(false);
  const prefs  = MEMORY.filter(m => m.type === 'pref');
  const events = MEMORY.filter(m => m.type === 'event');
  return (
    <div>
      <Heading num="01 / 记事" label="她　记　得" sub="夜阑识你，只在这台设备上。" />
      <div style={{ fontSize: 'calc(11px * var(--type-scale))', letterSpacing: 4, color: 'var(--paper-mute)', fontFamily: 'Inter, sans-serif', marginBottom: 14 }}>
        她记得的，关于你
      </div>
      {prefs.map((m, i) => (
        <MemoryRow key={i} m={m} />
      ))}
      <Divider />
      <div style={{ fontSize: 'calc(11px * var(--type-scale))', letterSpacing: 4, color: 'var(--paper-mute)', fontFamily: 'Inter, sans-serif', marginBottom: 14 }}>
        她记得的，那些事
      </div>
      {events.map((m, i) => (
        <MemoryRow key={i} m={m} />
      ))}
      <div style={{ marginTop: 36, paddingTop: 24, borderTop: '0.5px solid rgba(160,128,96,0.12)' }}>
        {!confirm ? (
          <button
            onClick={() => setConfirm(true)}
            style={{
              background: 'transparent',
              border: '0.5px solid rgba(160,128,96,0.3)',
              color: 'var(--paper-dim)',
              fontFamily: 'inherit', fontSize: 'calc(12px * var(--type-scale))', letterSpacing: 4,
              padding: '12px 24px', cursor: 'pointer',
              transition: 'all 0.4s ease',
            }}
            onMouseEnter={e => e.currentTarget.style.borderColor = 'rgba(220,140,110,0.5)'}
            onMouseLeave={e => e.currentTarget.style.borderColor = 'rgba(160,128,96,0.3)'}
          >
            让　她　忘　了　一　切
          </button>
        ) : (
          <div style={{
            border: '0.5px solid rgba(220,140,110,0.4)',
            padding: '16px 18px', borderRadius: 4,
            background: 'rgba(220,140,110,0.04)',
          }}>
            <p style={{ fontSize: 'calc(13px * var(--type-scale))', color: 'var(--paper)', lineHeight: 1.9, marginBottom: 14, fontStyle: 'italic' }}>
              她会忘掉这台设备上所有关于你的事。<br />
              ——以后她见你，像第一次见。
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setConfirm(false)} style={btnGhost}>留 着</button>
              <button onClick={() => setConfirm(false)} style={btnDanger}>当真，让她忘</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const btnGhost = {
  background: 'transparent', border: '0.5px solid rgba(160,128,96,0.3)',
  color: 'var(--paper-dim)', fontFamily: 'inherit', fontSize: 'calc(12px * var(--type-scale))',
  letterSpacing: 3, padding: '10px 20px', cursor: 'pointer',
};
const btnDanger = {
  background: 'rgba(220,140,110,0.08)', border: '0.5px solid rgba(220,140,110,0.5)',
  color: 'rgba(220,140,110,0.9)', fontFamily: 'inherit', fontSize: 'calc(12px * var(--type-scale))',
  letterSpacing: 3, padding: '10px 20px', cursor: 'pointer',
};

function MemoryRow({ m }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', gap: 14,
      padding: '10px 0',
      borderBottom: '0.5px solid rgba(160,128,96,0.08)',
    }}>
      <div style={{
        width: 6, height: 6, borderRadius: 3,
        background: m.type === 'pref' ? 'rgba(180,220,240,0.6)' : 'rgba(232,168,84,0.7)',
        flexShrink: 0,
      }} />
      <div style={{ flex: 1, fontSize: 'calc(13px * var(--type-scale))', color: 'var(--paper)', lineHeight: 1.85, letterSpacing: 0.3 }}>
        {m.text}
      </div>
      <div style={{ fontSize: 'calc(10px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 1, fontFamily: 'Inter, sans-serif', whiteSpace: 'nowrap' }}>
        {m.char} · {m.when}
      </div>
    </div>
  );
}

// ---------- 印 · achievements ----------
function PaneSeal() {
  return (
    <div>
      <Heading num="01 / 印" label="叙　事　之　印" sub="不是奖牌，是夜里留下的印迹。" />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {ACHIEVEMENTS.map(a => (
          <SealCard key={a.id} a={a} />
        ))}
      </div>
      <p style={{ fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 1, marginTop: 22, lineHeight: 1.9, fontStyle: 'italic' }}>
        印不弹窗、不喧哗。它只是在某句话之后，悄悄按了下去。
      </p>
    </div>
  );
}

function SealCard({ a }) {
  return (
    <div style={{
      position: 'relative',
      border: '0.5px solid',
      borderColor: a.unlocked ? 'rgba(220,76,60,0.4)' : 'rgba(120,108,88,0.18)',
      padding: '24px 20px', borderRadius: 4,
      background: a.unlocked ? 'rgba(220,76,60,0.04)' : 'rgba(0,0,0,0.18)',
      textAlign: 'center', minHeight: 150,
      display: 'flex', flexDirection: 'column', justifyContent: 'center',
      opacity: a.unlocked ? 1 : 0.45,
    }}>
      {/* sigil square */}
      <div style={{
        margin: '0 auto 14px', width: 36, height: 36,
        border: '0.5px solid',
        borderColor: a.unlocked ? 'rgba(208,76,60,0.7)' : 'rgba(120,108,88,0.3)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: a.unlocked ? 'rgba(208,76,60,0.08)' : 'transparent',
        boxShadow: a.unlocked ? '0 0 16px rgba(208,76,60,0.3)' : 'none',
      }}>
        <div style={{
          width: 6, height: 6, borderRadius: 3,
          background: a.unlocked ? 'rgba(232,168,84,0.95)' : 'rgba(120,108,88,0.4)',
          boxShadow: a.unlocked ? '0 0 8px rgba(232,168,84,0.7)' : 'none',
        }} />
      </div>
      <div style={{
        fontSize: 'calc(18px * var(--type-scale))', color: a.unlocked ? 'var(--gold-light)' : 'var(--paper-mute)',
        letterSpacing: 8, fontWeight: 400, marginBottom: 10,
      }}>
        {a.unlocked ? a.name : '?　?'}
      </div>
      <div style={{ fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-dim)', lineHeight: 1.8, fontStyle: 'italic', letterSpacing: 0.5 }}>
        {a.unlocked ? a.cond : '——还未触动'}
      </div>
      {a.unlocked && (
        <div style={{ fontSize: 'calc(10px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 2, marginTop: 10, fontFamily: 'Inter, sans-serif' }}>
          {a.ts}
        </div>
      )}
    </div>
  );
}

// ---------- 一问 · survey ----------
const SURVEY_QUESTIONS = [
  {
    q: '若今夜只能留下一个人陪你说话，你会选——',
    options: ['一个嘴硬心软的人', '一个沉默却记得你的人', '一个三年未见的旧识', '一个完全陌生的人'],
  },
  {
    q: '一句什么样的话，会让你愿意再回来一次？',
    options: ['"我等了你很久。"', '"你今天怎么了？"', '"再坐一会儿。"', '都不会，我只是路过'],
  },
  {
    q: '当夜将尽，你希望故事——',
    options: ['停在某句话里，让人惦记', '一个完整的告别', '什么都不说，灯就灭了', '让我自己决定何时收笔'],
  },
];

function PaneSurvey() {
  const [step, setStep] = uS(0);
  const [answers, setAnswers] = uS({});
  const [tStart, setTStart] = uS(Date.now());
  const [now, setNow] = uS(Date.now());
  const [done, setDone] = uS(false);
  uE(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  uE(() => { setTStart(Date.now()); }, [step]);
  const dwell = (now - tStart) / 1000;
  const can = dwell >= 5 && answers[step] !== undefined;
  const submit = () => {
    if (step < SURVEY_QUESTIONS.length - 1) setStep(step + 1);
    else setDone(true);
  };
  if (done) {
    return (
      <div style={{ textAlign: 'center', padding: '60px 0' }}>
        <Heading num="尾 / 一问" label="谢　过" sub="" />
        <p style={{ fontSize: 'calc(14px * var(--type-scale))', color: 'var(--paper)', lineHeight: 2, marginTop: 30, fontStyle: 'italic' }}>
          得了你三句心里话。<br />
          十二支烛已落到你的烛账。
        </p>
      </div>
    );
  }
  const Q = SURVEY_QUESTIONS[step];
  return (
    <div>
      <Heading num={`${String(step + 1).padStart(2, '0')} / 一问`} label="问　你" sub={`第 ${step + 1} 问 · 共 ${SURVEY_QUESTIONS.length} 问`} />
      <p style={{ fontSize: 'calc(16px * var(--type-scale))', color: 'var(--paper)', lineHeight: 2, marginBottom: 26, letterSpacing: 1 }}>
        {Q.q}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {Q.options.map((o, i) => {
          const picked = answers[step] === i;
          return (
            <button key={i}
              onClick={() => setAnswers({ ...answers, [step]: i })}
              style={{
                background: picked ? 'rgba(220,188,130,0.06)' : 'transparent',
                border: '0.5px solid',
                borderColor: picked ? 'rgba(220,188,130,0.5)' : 'rgba(160,128,96,0.18)',
                padding: '14px 18px', borderRadius: 4,
                color: picked ? 'var(--gold-light)' : 'var(--paper)',
                fontFamily: 'inherit', fontSize: 'calc(13px * var(--type-scale))', lineHeight: 1.8,
                textAlign: 'left', letterSpacing: 0.5,
                cursor: 'pointer', transition: 'all 0.4s ease',
              }}>
              {o}
            </button>
          );
        })}
      </div>
      <div style={{
        marginTop: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 2, fontFamily: 'Inter, sans-serif', fontStyle: 'italic' }}>
          {dwell < 5 ? `请慢慢想 · ${(5 - dwell).toFixed(1)}s` : '可以落笔了'}
        </div>
        <button onClick={submit} disabled={!can}
          style={{
            background: 'transparent',
            border: '0.5px solid',
            borderColor: can ? 'rgba(220,188,130,0.5)' : 'rgba(160,128,96,0.18)',
            color: can ? 'var(--gold-light)' : 'var(--paper-mute)',
            fontFamily: 'inherit', fontSize: 'calc(12px * var(--type-scale))', letterSpacing: 4,
            padding: '10px 22px', cursor: can ? 'pointer' : 'not-allowed',
            transition: 'all 0.5s ease',
            opacity: can ? 1 : 0.5,
          }}>
          {step < SURVEY_QUESTIONS.length - 1 ? '下　一　问' : '收　笔'}
        </button>
      </div>
    </div>
  );
}

// ---------- 调息 · settings / boundary ----------
function PaneBreath({ narrativeBoundary, onBoundaryChange }) {
  const labels = ['纯　净', '克　制', '暧　昧', '显　性', '直　白'];
  const subs = [
    '只有故事，无关身体',
    '欲念只在留白处',
    '言尽于此，意在弦外',
    '该来时不回避',
    '不绕弯',
  ];
  return (
    <div>
      <Heading num="01 / 调息" label="叙　事　边　界" sub="夜可以多近，由你定。" />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 28 }}>
        {labels.map((l, i) => {
          const k = i + 1;
          const picked = narrativeBoundary === k;
          return (
            <button key={k}
              onClick={() => onBoundaryChange(k)}
              style={{
                background: picked ? 'rgba(220,188,130,0.05)' : 'transparent',
                border: '0.5px solid',
                borderColor: picked ? 'rgba(220,188,130,0.5)' : 'rgba(160,128,96,0.18)',
                padding: '14px 18px', borderRadius: 4,
                cursor: 'pointer', textAlign: 'left',
                fontFamily: 'inherit',
                transition: 'all 0.5s ease',
                display: 'flex', alignItems: 'center', gap: 18,
              }}>
              <span style={{
                fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)', fontFamily: 'Inter, sans-serif', letterSpacing: 2, width: 16,
              }}>
                {String(k).padStart(2, '0')}
              </span>
              <span style={{
                fontSize: 'calc(14px * var(--type-scale))', color: picked ? 'var(--gold-light)' : 'var(--paper)',
                letterSpacing: 5, fontWeight: 400, width: 70,
              }}>
                {l}
              </span>
              <span style={{ fontSize: 'calc(12px * var(--type-scale))', color: 'var(--paper-dim)', fontStyle: 'italic', letterSpacing: 0.5, flex: 1 }}>
                {subs[i]}
              </span>
            </button>
          );
        })}
      </div>
      <Divider />
      <Heading num="02 / 调息" label="其　他" />
      <FaintRow left="字号"     right="标准 · 15" />
      <FaintRow left="行间距"   right="松 · 1.9" />
      <FaintRow left="进入色温" right="暖羊皮纸" />
      <FaintRow left="离开方式" right="文字渐淡 · 屏暗" />
      <FaintRow left="本机记忆" right="247 条 · 6 MB" hl />
      <FaintRow left="暗号"     right="尚未发声" />
      <p style={{ fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)', letterSpacing: 1, marginTop: 22, lineHeight: 1.9, fontStyle: 'italic' }}>
        若有一句来自夜里的暗语，对她小声说一遍，门会自己开。
      </p>
    </div>
  );
}

window.DrawerRail = DrawerRail;
window.DrawerShell = DrawerShell;
