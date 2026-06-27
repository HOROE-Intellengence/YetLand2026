// Scenes: Opening, CharacterSelect, Conversation, NarrativeCutoff

const { useState, useEffect, useRef, useMemo } = React;

// ---------- shared helpers ----------
function useFadeIn(deps = []) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
    const t = setTimeout(() => setShown(true), 40);
    return () => clearTimeout(t);
  }, deps);
  return shown;
}

// A line of text that fades + drifts in. If `glow`, it breathes softly.
function Line({ children, delay = 0, glow = false, big = false }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return (
    <p
      style={{
        opacity: on ? 1 : 0,
        transform: on ? 'translateY(0)' : 'translateY(8px)',
        filter: on ? 'blur(0)' : 'blur(2px)',
        transition: 'opacity 1.2s ease, transform 1.2s ease, filter 1.2s ease',
        fontSize: big ? 19 : 17,
        lineHeight: 1.95,
        margin: '0 0 22px',
        color: 'var(--paper)',
        textShadow: glow ? '0 0 18px rgba(220, 188, 130, 0.35), 0 0 4px rgba(220, 188, 130, 0.25)' : 'none',
        animation: glow && on ? 'breathe 4s ease-in-out infinite' : 'none',
        fontWeight: glow ? 400 : 300,
      }}
    >
      {children}
    </p>
  );
}

// ---------- Opening ----------
function OpeningScene({ onEnter }) {
  const [phase, setPhase] = useState(0); // 0 dim, 1 question, 2 cursor blinking, 3 fading out
  const [typed, setTyped] = useState('');
  const inputRef = useRef(null);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 1400);
    const t2 = setTimeout(() => setPhase(2), 2800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  useEffect(() => {
    if (phase === 2) inputRef.current?.focus();
  }, [phase]);

  const handleKey = (e) => {
    if (e.key === 'Enter' && typed.trim()) {
      setPhase(3);
      setTimeout(() => onEnter(typed.trim()), 1200);
    }
  };

  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', zIndex: 5,
      opacity: phase === 3 ? 0 : 1,
      transition: 'opacity 1.2s ease',
    }}>
      <div style={{
        fontSize: 'calc(13px * var(--type-scale))', letterSpacing: 8, color: 'var(--paper-mute)',
        marginBottom: 60, fontWeight: 300,
        opacity: phase >= 1 ? 1 : 0,
        transition: 'opacity 2s ease',
      }}>
        夜　阑
      </div>
      <div style={{
        fontSize: 'calc(22px * var(--type-scale))', color: 'var(--paper)', fontWeight: 300,
        letterSpacing: 2, marginBottom: 48,
        opacity: phase >= 1 ? 1 : 0,
        transform: phase >= 1 ? 'translateY(0)' : 'translateY(12px)',
        filter: phase >= 1 ? 'blur(0)' : 'blur(3px)',
        transition: 'all 2s ease',
        textShadow: '0 0 24px rgba(200, 168, 120, 0.25)',
      }}>
        今夜，你是什么角色？
      </div>
      <div style={{
        fontSize: 'calc(12px * var(--type-scale))', color: 'var(--paper-mute)',
        letterSpacing: 2, marginBottom: 36, marginTop: -32,
        opacity: phase >= 1 ? 0.65 : 0,
        transition: 'opacity 2s ease 0.6s',
        fontWeight: 300,
      }}>
        夜晚为你敞开，而非"user_1234"
      </div>
      <div style={{
        position: 'relative',
        width: 360,
        opacity: phase >= 2 ? 1 : 0,
        transition: 'opacity 1.5s ease',
      }}>
        <input
          ref={inputRef}
          value={typed}
          onChange={e => setTyped(e.target.value)}
          onKeyDown={handleKey}
          placeholder="——"
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            borderBottom: '0.5px solid rgba(160, 128, 96, 0.4)',
            color: 'var(--paper)',
            fontFamily: 'inherit',
            fontSize: 'calc(17px * var(--type-scale))',
            fontWeight: 300,
            textAlign: 'center',
            padding: '12px 0',
            outline: 'none',
            letterSpacing: 1,
          }}
        />
        <div style={{
          fontSize: 'calc(11px * var(--type-scale))', color: 'var(--paper-mute)',
          marginTop: 24, letterSpacing: 4, textAlign: 'center',
          opacity: 0.6,
        }}>
          回　车　即　可
        </div>
      </div>
    </div>
  );
}

// ---------- Character Select ----------
const CHARACTERS = [
  {
    id: 'gu',
    name: '顾　远',
    epigraph: '雨夜，旧书店的他。三年没见。',
    style: '先情后欲 · 现代克制',
    accent: 'rgba(200, 168, 120, 0.5)',
  },
  {
    id: 'ji',
    name: '季　南',
    epigraph: '深夜便利店店员。话少，眼神不少。',
    style: '现代推拉 · 反差温柔',
    accent: 'rgba(180, 200, 220, 0.4)',
    locked: false,
  },
  {
    id: 'qing',
    name: '青　衣',
    epigraph: '江南雨夜，故人来访。',
    style: '古风暧昧 · 含蓄隽永',
    accent: 'rgba(220, 200, 160, 0.45)',
  },
];

function CharacterSelect({ greeting, onPick }) {
  const [hover, setHover] = useState(null);
  const [picked, setPicked] = useState(null);
  const shown = useFadeIn();

  const handlePick = (c) => {
    setPicked(c.id);
    setTimeout(() => onPick(c), 1100);
  };

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      zIndex: 5,
      opacity: picked ? 0 : 1,
      transition: 'opacity 1.1s ease',
    }}>
      <div style={{
        fontSize: 'calc(13px * var(--type-scale))', color: 'var(--paper-dim)',
        letterSpacing: 4, fontWeight: 300, marginBottom: 8,
        opacity: shown ? 1 : 0, transition: 'opacity 1.5s ease',
      }}>
        「{greeting}」
      </div>
      <div style={{
        fontSize: 'calc(14px * var(--type-scale))', color: 'var(--paper-mute)',
        letterSpacing: 3, marginBottom: 70,
        opacity: shown ? 0.7 : 0, transition: 'opacity 2s ease 0.4s',
      }}>
        今夜有几扇门为你开着
      </div>

      <div style={{ display: 'flex', gap: 40 }}>
        {CHARACTERS.map((c, i) => (
          <div
            key={c.id}
            onMouseEnter={() => setHover(c.id)}
            onMouseLeave={() => setHover(null)}
            onClick={() => handlePick(c)}
            style={{
              width: 220, height: 320,
              border: '0.5px solid rgba(160, 128, 96, 0.25)',
              borderColor: hover === c.id ? c.accent : 'rgba(160, 128, 96, 0.25)',
              background: hover === c.id
                ? 'linear-gradient(180deg, rgba(160,128,96,0.08), rgba(160,128,96,0.02))'
                : 'rgba(255,255,255,0.012)',
              padding: '40px 28px',
              cursor: 'pointer',
              display: 'flex', flexDirection: 'column',
              justifyContent: 'space-between',
              transition: 'all 1.2s cubic-bezier(.2,.7,.2,1)',
              transform: hover === c.id ? 'translateY(-6px)' : 'translateY(0)',
              boxShadow: hover === c.id
                ? `0 0 60px -15px ${c.accent}`
                : 'none',
              opacity: shown ? 1 : 0,
              transitionDelay: shown ? `${0.6 + i * 0.2}s, 0s, 0s, 0s, 0s` : '0s',
              animation: shown ? `fadeUp 1.6s ${0.6 + i * 0.2}s both` : 'none',
            }}
          >
            <div>
              <div style={{
                fontSize: 'calc(11px * var(--type-scale))', letterSpacing: 3,
                color: 'var(--paper-mute)', marginBottom: 24,
                fontFamily: 'Inter, sans-serif',
              }}>
                {String(i + 1).padStart(2, '0')}
              </div>
              <div style={{
                fontSize: 'calc(24px * var(--type-scale))', fontWeight: 400,
                color: hover === c.id ? 'var(--gold-light)' : 'var(--paper)',
                marginBottom: 16, letterSpacing: 4,
                transition: 'color 1.2s ease',
                textShadow: hover === c.id ? `0 0 20px ${c.accent}` : 'none',
              }}>
                {c.name}
              </div>
              <div style={{
                fontSize: 'calc(13px * var(--type-scale))', color: 'var(--paper-dim)',
                lineHeight: 1.9, fontStyle: 'italic',
                fontWeight: 300,
              }}>
                {c.epigraph}
              </div>
            </div>
            <div style={{
              fontSize: 'calc(10px * var(--type-scale))', letterSpacing: 2,
              color: 'var(--paper-mute)',
              fontFamily: 'Inter, sans-serif',
              borderTop: '0.5px solid rgba(160,128,96,0.15)',
              paddingTop: 14,
            }}>
              {c.style}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Conversation ----------
function Conversation({ character, stage, candle, onCandleAuto, onStageAuto, onAchievement, onCutoff, autoCandle, autoStage }) {
  const [history, setHistory] = useState(() =>
    DIALOGUE_OPENING.map((t, i) => ({
      id: 'op-' + i, text: t, glow: i === 2, side: 'ai',
      mode: /^[\s　]*[「『"“]/.test(t) ? 'dialogue' : 'narration',
    }))
  );
  const [fading, setFading] = useState(false);
  const [turn, setTurn] = useState(0);
  const [typing, setTyping] = useState(false);
  const [draft, setDraft] = useState('');
  const [stageLocal, setStageLocal] = useState('daily');
  const inputRef = useRef(null);
  const scrollRef = useRef(null);

  const effectiveStage = autoStage ? stageLocal : stage;

  // auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    }
  }, [history, typing]);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const send = () => {
    if (!draft.trim() || typing) return;
    const userText = draft.trim();
    setHistory(h => [...h, { id: 'u-' + Date.now(), text: userText, side: 'user' }]);
    setDraft('');

    // Match script
    const t = turn;
    const m = matchBranch(t, userText);
    const branch = m.branch || { reply: SCRIPT[t]?.default || ["……"] };

    setTyping(true);

    // Reveal AI lines one-by-one with stagger
    const lines = branch.reply;
    let acc = 600;
    lines.forEach((ln, i) => {
      const isObj = typeof ln === 'object';
      const text = isObj ? ln.text : ln;
      const glow = isObj ? !!ln.glow : false;
      // narration vs dialogue: lines starting with 「 are spoken
      const isDialogue = /^[\s　]*[「『"“]/.test(text);
      // pre-pause: glow lines get an extra 700ms beat (handbook §04)
      if (glow) acc += 700;
      const delay = acc;
      // dialogue beats are quicker ("spoken"), narration breathes more ("written")
      if (isDialogue) {
        acc += 380 + text.length * 22;
      } else {
        acc += 700 + text.length * 32;
      }
      setTimeout(() => {
        setHistory(h => [...h, { id: `ai-${t}-${i}-${Date.now()}`, text, glow, side: 'ai', mode: isDialogue ? 'dialogue' : 'narration' }]);
      }, delay);
    });

    // Stage / achievement / next-turn after all lines
    setTimeout(() => {
      setTyping(false);
      if (branch.stage && autoStage) {
        setStageLocal(branch.stage);
        onStageAuto?.(branch.stage);
      } else if (SCRIPT[t]?.stage && autoStage) {
        setStageLocal(SCRIPT[t].stage);
        onStageAuto?.(SCRIPT[t].stage);
      }
      if (branch.achievement) {
        onAchievement?.(branch.achievement);
      }
      // candle auto-decay
      if (autoCandle) {
        if (t === 1) onCandleAuto?.('mid');
        if (t === 2) onCandleAuto?.('low');
      }
      // cutoff after turn 3 (the climax turn)
      const next = t + 1;
      if (next >= SCRIPT.length) {
        setTimeout(() => setFading(true), 1200);
        setTimeout(() => onCutoff?.(), 3600);
      } else {
        setTurn(next);
      }
    }, acc + 300);
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // Stage → reading-frame styling
  const stageFrame = useMemo(() => {
    switch (effectiveStage) {
      case 'rise':   return { padX: 60, fontSize: 'calc(17px * var(--type-scale))', lineH: 1.85, tint: 'rgba(200, 168, 120, 0.05)' };
      case 'climax': return { padX: 40, fontSize: 'calc(18px * var(--type-scale))', lineH: 1.75, tint: 'rgba(200, 168, 120, 0.07)' };
      case 'after':  return { padX: 80, fontSize: 'calc(16px * var(--type-scale))', lineH: 2.05, tint: 'rgba(200, 168, 120, 0.02)' };
      default:       return { padX: 80, fontSize: 'calc(17px * var(--type-scale))', lineH: 1.95, tint: 'rgba(200, 168, 120, 0.025)' };
    }
  }, [effectiveStage]);

  // candle dot color
  const candleColor = candle === 'low'
    ? 'rgba(220, 100, 80, 0.85)'
    : candle === 'mid'
      ? 'rgba(220, 170, 90, 0.9)'
      : 'rgba(180, 220, 160, 0.85)';

  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', flexDirection: 'column',
      zIndex: 4,
      transition: 'background 2s ease, opacity 2s ease',
      opacity: fading ? 0.5 : 1,
      background: `radial-gradient(ellipse at 50% 30%, ${stageFrame.tint}, transparent 70%)`,
    }}>
      {/* candle dot — top-right, no label, no number */}
      <div style={{
        position: 'absolute', top: 28, right: 32,
        display: 'flex', alignItems: 'center', gap: 0,
      }}>
        <div style={{
          width: 8, height: 8, borderRadius: 4,
          background: candleColor,
          boxShadow: `0 0 20px ${candleColor}, 0 0 8px ${candleColor}`,
          animation: candle === 'low' ? 'candleLow 1.4s ease-in-out infinite'
            : candle === 'mid' ? 'candleMid 2.2s ease-in-out infinite'
            : 'candleFull 4s ease-in-out infinite',
        }} />
      </div>

      {/* hint of who they're with — top-left, very faint */}
      <div style={{
        position: 'absolute', top: 28, left: 36,
        fontSize: 'calc(12px * var(--type-scale))', letterSpacing: 4, color: 'var(--paper-dim)',
        opacity: fading ? 0 : 0.65,
        transition: 'opacity 2s ease',
      }}>
        {character?.name}
      </div>

      {/* reading area */}
      <div ref={scrollRef} style={{
        flex: 1, overflowY: 'auto',
        display: 'flex', justifyContent: 'center',
        padding: '100px 0 30px',
        scrollbarWidth: 'none',
      }}>
        <div style={{
          width: '100%',
          maxWidth: 620,
          padding: `0 ${stageFrame.padX}px`,
          transition: 'padding 2.5s cubic-bezier(.4,.7,.3,1), font-size 2s ease',
        }}>
          {history.map((h, i) => (
            <MessageLine key={h.id} item={h} stageFrame={stageFrame} />
          ))}
          {typing && <TypingDots />}
        </div>
      </div>

      {/* input — minimal, no send button, no nothing */}
      <div style={{
        display: 'flex', justifyContent: 'center',
        padding: '20px 0 40px',
      }}>
        <div style={{
          width: '100%', maxWidth: 620,
          padding: `0 ${stageFrame.padX}px`,
          transition: 'padding 2.5s cubic-bezier(.4,.7,.3,1)',
        }}>
          <div style={{
            position: 'relative',
            borderTop: '0.5px solid rgba(160, 128, 96, 0.18)',
            paddingTop: 18,
          }}>
            <textarea
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={handleKey}
              placeholder={typing ? '' : '……'}
              rows={1}
              disabled={typing}
              style={{
                width: '100%',
                background: 'transparent',
                border: 'none',
                color: 'var(--paper)',
                fontFamily: 'inherit',
                fontSize: stageFrame.fontSize - 1,
                lineHeight: 1.7,
                fontWeight: 300,
                resize: 'none',
                outline: 'none',
                opacity: typing ? 0.3 : 1,
                transition: 'opacity 0.6s ease',
                letterSpacing: 0.5,
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageLine({ item, stageFrame }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setOn(true), 50);
    return () => clearTimeout(t);
  }, []);
  if (item.side === 'user') {
    return (
      <p style={{
        opacity: on ? 0.55 : 0,
        transform: on ? 'translateY(0)' : 'translateY(6px)',
        transition: 'opacity 1s ease, transform 1s ease',
        fontSize: stageFrame.fontSize - 2,
        lineHeight: stageFrame.lineH,
        margin: '8px 0 18px',
        color: 'var(--paper-dim)',
        textAlign: 'right',
        fontStyle: 'italic',
        letterSpacing: 0.5,
      }}>
        {item.text}
      </p>
    );
  }
  // narration: smaller, dimmer, italic, looser leading
  // dialogue: full size, paper color, normal weight, regular leading
  const isNarration = item.mode === 'narration';
  return (
    <p style={{
      opacity: on ? 1 : 0,
      transform: on ? 'translateY(0)' : 'translateY(10px)',
      filter: on ? 'blur(0)' : 'blur(2.5px)',
      transition: isNarration
        ? 'opacity 1.8s ease, transform 1.8s ease, filter 1.8s ease'
        : 'opacity 1.2s ease, transform 1.2s ease, filter 1.2s ease',
      fontSize: isNarration ? stageFrame.fontSize - 2 : stageFrame.fontSize,
      lineHeight: isNarration ? 2.0 : stageFrame.lineH,
      margin: isNarration ? '0 0 18px' : '4px 0 26px',
      color: isNarration ? 'var(--paper-dim)' : 'var(--paper)',
      fontStyle: isNarration ? 'italic' : 'normal',
      textShadow: item.glow ? '0 0 22px rgba(200, 168, 120, 0.45), 0 0 4px rgba(220, 188, 130, 0.3)' : 'none',
      fontWeight: item.glow ? 400 : 300,
      animation: item.glow && on ? 'breathe 4.5s ease-in-out infinite' : 'none',
      letterSpacing: 0.3,
    }}>
      {item.text}
    </p>
  );
}

function TypingDots() {
  return (
    <div style={{
      display: 'flex', gap: 8, marginTop: 4, marginBottom: 24,
      opacity: 0.6,
    }}>
      {[0, 1, 2].map(i => (
        <span key={i} style={{
          width: 4, height: 4, borderRadius: 2,
          background: 'var(--gold-light)',
          animation: `typingDot 1.4s ${i * 0.18}s ease-in-out infinite`,
        }} />
      ))}
    </div>
  );
}

// ---------- Achievement Flash ----------
function AchievementFlash({ ach, onDone }) {
  useEffect(() => {
    if (!ach) return;
    const t = setTimeout(() => onDone(), 4200);
    return () => clearTimeout(t);
  }, [ach]);
  if (!ach) return null;
  return (
    <div style={{
      position: 'absolute', top: '50%', left: '50%',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none', zIndex: 6,
      animation: 'achFlash 4.2s ease',
      textAlign: 'center',
    }}>
      <div style={{
        fontSize: 'calc(11px * var(--type-scale))', letterSpacing: 6,
        color: 'var(--gold-light)', marginBottom: 12,
        textShadow: '0 0 20px rgba(220, 188, 130, 0.6)',
        fontFamily: 'Inter, sans-serif',
      }}>
        ◦
      </div>
      <div style={{
        fontSize: 'calc(28px * var(--type-scale))', color: 'var(--gold-light)',
        letterSpacing: 8, fontWeight: 300, marginBottom: 14,
        textShadow: '0 0 30px rgba(220, 188, 130, 0.7), 0 0 8px rgba(220, 188, 130, 0.5)',
      }}>
        {ach.name}
      </div>
      <div style={{
        fontSize: 'calc(13px * var(--type-scale))', color: 'var(--paper-dim)',
        letterSpacing: 2, fontStyle: 'italic',
      }}>
        {ach.desc}
      </div>
    </div>
  );
}

// ---------- Narrative Cutoff ----------
function NarrativeCutoff({ onRestart }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 1400);
    const t2 = setTimeout(() => setPhase(2), 4500);
    const t3 = setTimeout(() => setPhase(3), 7800);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, []);

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: `radial-gradient(ellipse at 50% 50%, rgba(20,16,12,0.4), rgba(0,0,0,0.95))`,
      zIndex: 7, display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column',
      transition: 'background 3s ease',
    }}>
      <div style={{
        maxWidth: 560,
        padding: '0 60px',
        textAlign: 'center',
      }}>
        <p style={{
          fontSize: 'calc(18px * var(--type-scale))', lineHeight: 2, color: 'var(--paper)',
          opacity: phase >= 0 ? 1 : 0,
          transform: phase >= 0 ? 'translateY(0)' : 'translateY(8px)',
          filter: phase >= 0 ? 'blur(0)' : 'blur(2px)',
          transition: 'all 2s ease',
          marginBottom: 24,
          fontWeight: 300,
        }}>
          他的手停在你的手背上。
        </p>
        <p style={{
          fontSize: 'calc(18px * var(--type-scale))', lineHeight: 2, color: 'var(--paper)',
          opacity: phase >= 1 ? 1 : 0,
          transform: phase >= 1 ? 'translateY(0)' : 'translateY(8px)',
          filter: phase >= 1 ? 'blur(0)' : 'blur(2px)',
          transition: 'all 2.5s ease',
          marginBottom: 60,
          fontWeight: 300,
          textShadow: '0 0 22px rgba(220, 188, 130, 0.4)',
        }}>
          窗外天色，将明未明。
        </p>
        <p style={{
          fontSize: 'calc(15px * var(--type-scale))', lineHeight: 2, color: 'var(--paper-dim)',
          opacity: phase >= 2 ? 1 : 0,
          transition: 'opacity 3s ease',
          fontStyle: 'italic',
          marginBottom: 60,
        }}>
          ——今夜将尽。
          <br />
          明晚，他等你回来。
        </p>
        <button
          onClick={onRestart}
          style={{
            background: 'transparent',
            border: '0.5px solid rgba(160, 128, 96, 0.4)',
            color: 'var(--gold-light)',
            fontFamily: 'inherit',
            fontSize: 'calc(13px * var(--type-scale))',
            letterSpacing: 6,
            padding: '14px 36px',
            cursor: 'pointer',
            opacity: phase >= 3 ? 1 : 0,
            transition: 'opacity 2s ease, background 0.6s ease, border-color 0.6s ease',
            fontWeight: 300,
          }}
          onMouseEnter={e => {
            e.currentTarget.style.background = 'rgba(160, 128, 96, 0.08)';
            e.currentTarget.style.borderColor = 'rgba(200, 168, 120, 0.7)';
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
            e.currentTarget.style.borderColor = 'rgba(160, 128, 96, 0.4)';
          }}
        >
          再　翻　一　页
        </button>
      </div>
    </div>
  );
}

Object.assign(window, {
  OpeningScene, CharacterSelect, Conversation,
  AchievementFlash, NarrativeCutoff, CHARACTERS,
});
