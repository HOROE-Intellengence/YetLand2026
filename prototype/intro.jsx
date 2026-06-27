// Cold-open intro — an elaborate, cinematic ignition.
// Layers: ink bloom → star map → triple sigil rings (concentric, multi-color) →
// petal halo bursts → calligraphic title with stroke reveal → afterglow particles.
// Total ~10s. Tap or wait → opening scene.

const { useState: useSt, useEffect: useEf, useRef: useRf, useMemo: useMm } = React;

// Palette — multi-hue but cohesive (deep night → ember → indigo → vermilion → moon-white → gold)
const PAL = {
  ink:       'rgba(8, 10, 18, 1)',
  indigo:    'rgba(78, 92, 168, 1)',     // 靛
  indigoSoft:'rgba(78, 92, 168, 0.55)',
  cyan:      'rgba(110, 188, 210, 1)',   // 月白
  vermilion: 'rgba(208, 76, 60, 1)',     // 丹砂
  vermilionSoft: 'rgba(208, 76, 60, 0.5)',
  amber:     'rgba(232, 168, 84, 1)',    // 琥珀
  gold:      'rgba(220, 188, 130, 1)',   // 鎏金
  goldSoft:  'rgba(220, 188, 130, 0.6)',
  pearl:     'rgba(245, 232, 208, 1)',   // 月珠
  plum:      'rgba(132, 70, 110, 1)',    // 绛紫
};

function IntroScene({ onDone }) {
  const [phase, setPhase] = useSt(0);
  // 0 : black void
  // 1 : ink drop + heartbeat ember (1500ms)
  // 2 : star map awakens (1500ms)
  // 3 : sigil rings materialize, counter-rotating, color bleeds in (2200ms)
  // 4 : ignition — petal burst + sparks + ink wash (1800ms)
  // 5 : title reveal with stroke draw (2200ms)
  // 6 : exit fade (600ms)
  const sparksRef = useRf(null);
  const inkRef = useRf(null);

  useEf(() => {
    const ts = [
      setTimeout(() => setPhase(1),  120),
      setTimeout(() => setPhase(2),  1700),
      setTimeout(() => setPhase(3),  3300),
      setTimeout(() => setPhase(4),  5600),
      setTimeout(() => setPhase(5),  7400),
      setTimeout(() => setPhase(6),  9800),
      setTimeout(() => onDone(),    10400),
    ];
    return () => ts.forEach(clearTimeout);
  }, []);

  const skip = () => { setPhase(6); setTimeout(onDone, 500); };

  // Pre-compute star positions
  const stars = useMm(() => {
    const out = [];
    for (let i = 0; i < 80; i++) {
      const r = 220 + Math.random() * 240;
      const a = Math.random() * Math.PI * 2;
      out.push({
        x: 50 + Math.cos(a) * r / 12,
        y: 50 + Math.sin(a) * r / 12,
        size: 0.4 + Math.random() * 1.6,
        delay: Math.random() * 1.2,
        hue: Math.random() < 0.15 ? 'vermilion' : Math.random() < 0.4 ? 'cyan' : 'pearl',
      });
    }
    return out;
  }, []);

  // Constellation lines (a few connecting stars)
  const lines = useMm(() => {
    const segs = [];
    for (let i = 0; i < 14; i++) {
      const a1 = Math.random() * Math.PI * 2;
      const a2 = a1 + (Math.random() - 0.5) * 1.2;
      const r1 = 18 + Math.random() * 22;
      const r2 = 18 + Math.random() * 22;
      segs.push({
        x1: 50 + Math.cos(a1) * r1, y1: 50 + Math.sin(a1) * r1,
        x2: 50 + Math.cos(a2) * r2, y2: 50 + Math.sin(a2) * r2,
        delay: 0.2 + Math.random() * 1.2,
      });
    }
    return segs;
  }, []);

  // Sparks canvas (ignition phase)
  useEf(() => {
    if (phase !== 4) return;
    const cvs = sparksRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = cvs.clientWidth * dpr;
    cvs.height = cvs.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    const W = cvs.clientWidth, H = cvs.clientHeight;
    const cx = W / 2, cy = H / 2;
    const sparks = [];
    const colors = [
      [255, 220, 160],
      [232, 168, 84],
      [208, 110, 80],
      [245, 232, 208],
      [180, 200, 230],
    ];
    for (let i = 0; i < 160; i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 5.5;
      const c = colors[Math.floor(Math.random() * colors.length)];
      sparks.push({
        x: cx, y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        life: 1,
        decay: 0.006 + Math.random() * 0.012,
        r: 0.6 + Math.random() * 1.8,
        c,
      });
    }
    let raf;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const s of sparks) {
        if (s.life <= 0) continue;
        alive++;
        s.x += s.vx; s.y += s.vy;
        s.vy += 0.035;
        s.vx *= 0.992;
        s.life -= s.decay;
        const a = Math.max(0, s.life);
        const haloR = s.r * 6;
        const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, haloR);
        grad.addColorStop(0, `rgba(${s.c[0]}, ${s.c[1]}, ${s.c[2]}, ${a * 0.85})`);
        grad.addColorStop(0.4, `rgba(${s.c[0]}, ${s.c[1]}, ${s.c[2]}, ${a * 0.3})`);
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(s.x, s.y, haloR, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = `rgba(${Math.min(255, s.c[0]+30)}, ${Math.min(255, s.c[1]+40)}, ${Math.min(255, s.c[2]+50)}, ${a})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
      }
      if (alive > 0) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Ink-drop spreading canvas
  useEf(() => {
    if (phase < 1) return;
    const cvs = inkRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = cvs.clientWidth * dpr;
    cvs.height = cvs.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    const W = cvs.clientWidth, H = cvs.clientHeight;
    const cx = W / 2, cy = H / 2;
    let t0 = performance.now();
    let raf;
    const draw = (now) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      // Multi-layer breathing ink wash
      const layers = [
        { r: 220 + Math.sin(t * 0.7) * 30, alpha: 0.10, color: '78, 92, 168' },     // indigo
        { r: 360 + Math.cos(t * 0.5) * 40, alpha: 0.06, color: '132, 70, 110' },    // plum
        { r: 480 + Math.sin(t * 0.4 + 1) * 50, alpha: 0.04, color: '208, 76, 60' }, // vermilion
      ];
      for (const L of layers) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, L.r);
        g.addColorStop(0, `rgba(${L.color}, ${L.alpha})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Sigil — three concentric rings, multi-color, counter-rotating
  const sigilOpacity = phase >= 3 ? (phase >= 5 ? 0 : 1) : 0;
  const sigilScale = phase >= 3 ? 1 : 0.55;
  const sigilBlur = phase >= 5 ? 'blur(10px)' : 'blur(0)';

  const sigil = (
    <svg
      width="640" height="640" viewBox="0 0 640 640"
      style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: `translate(-50%, -50%) scale(${sigilScale})`,
        opacity: sigilOpacity,
        transition: phase >= 5
          ? 'opacity 1.8s ease, transform 1.8s ease, filter 1.6s ease'
          : 'opacity 2.2s cubic-bezier(.2,.6,.2,1), transform 2.4s cubic-bezier(.2,.6,.2,1)',
        filter: sigilBlur,
        pointerEvents: 'none',
      }}
    >
      <defs>
        <radialGradient id="halo1" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="rgba(232, 168, 84, 0.20)" />
          <stop offset="55%" stopColor="rgba(132, 70, 110, 0.08)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <radialGradient id="halo2" cx="50%" cy="50%" r="50%">
          <stop offset="0%"  stopColor="rgba(78, 92, 168, 0.18)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>
        <linearGradient id="ringGold" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="rgba(245, 232, 208, 0.9)" />
          <stop offset="50%"  stopColor="rgba(220, 188, 130, 0.85)" />
          <stop offset="100%" stopColor="rgba(160, 110, 70, 0.7)" />
        </linearGradient>
        <linearGradient id="ringIndigo" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="rgba(110, 188, 210, 0.8)" />
          <stop offset="100%" stopColor="rgba(78, 92, 168, 0.7)" />
        </linearGradient>
        <linearGradient id="ringVerm" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="rgba(232, 168, 84, 0.8)" />
          <stop offset="100%" stopColor="rgba(208, 76, 60, 0.7)" />
        </linearGradient>
        <filter id="softblur" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="0.4" />
        </filter>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* outer halos — layered radial glows */}
      <circle cx="320" cy="320" r="300" fill="url(#halo1)" />
      <circle cx="320" cy="320" r="220" fill="url(#halo2)" />

      {/* outermost ring — gold, slow CW */}
      <g style={{ transformOrigin: '320px 320px', animation: 'sigilSpinCW 28s linear infinite' }}>
        <circle cx="320" cy="320" r="270" fill="none" stroke="url(#ringGold)" strokeWidth="0.6" opacity="0.7" />
        <circle cx="320" cy="320" r="262" fill="none" stroke="rgba(220, 188, 130, 0.25)" strokeWidth="0.4" strokeDasharray="2 4" />
        {/* outer rune ticks — 36 long/short alternating */}
        {Array.from({ length: 36 }).map((_, i) => {
          const a = (i / 36) * Math.PI * 2;
          const long = i % 3 === 0;
          const r1 = 270;
          const r2 = long ? 245 : 256;
          const x1 = 320 + Math.cos(a) * r1, y1 = 320 + Math.sin(a) * r1;
          const x2 = 320 + Math.cos(a) * r2, y2 = 320 + Math.sin(a) * r2;
          return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
                       stroke={long ? "rgba(245, 232, 208, 0.85)" : "rgba(220, 188, 130, 0.55)"} strokeWidth={long ? 0.8 : 0.5} />;
        })}
        {/* runic glyphs at cardinal points */}
        {['ᚠ','ᚱ','ᛟ','ᛗ','ᚺ','ᛏ','ᛒ','ᛞ','ᛇ','ᚷ','ᛚ','ᚦ'].map((g, i, arr) => {
          const a = (i / arr.length) * Math.PI * 2 - Math.PI / 2;
          const r = 230;
          return (
            <text key={i}
                  x={320 + Math.cos(a) * r}
                  y={320 + Math.sin(a) * r + 4}
                  textAnchor="middle"
                  fill="rgba(245, 232, 208, 0.85)"
                  fontSize="13"
                  fontFamily="Georgia, serif"
                  style={{ filter: 'url(#softblur)' }}>
              {g}
            </text>
          );
        })}
      </g>

      {/* middle ring — indigo/cyan, CCW */}
      <g style={{ transformOrigin: '320px 320px', animation: 'sigilSpinCCW 22s linear infinite' }}>
        <circle cx="320" cy="320" r="200" fill="none" stroke="url(#ringIndigo)" strokeWidth="0.5" opacity="0.65" />
        <circle cx="320" cy="320" r="190" fill="none" stroke="rgba(110, 188, 210, 0.2)" strokeWidth="0.3" />
        {/* mid ticks - dots */}
        {Array.from({ length: 60 }).map((_, i) => {
          const a = (i / 60) * Math.PI * 2;
          const x = 320 + Math.cos(a) * 195, y = 320 + Math.sin(a) * 195;
          return <circle key={i} cx={x} cy={y} r={i % 5 === 0 ? 1.4 : 0.6}
                  fill={i % 5 === 0 ? "rgba(180, 220, 240, 0.95)" : "rgba(110, 188, 210, 0.6)"} />;
        })}
        {/* small triangles at 8 points */}
        {Array.from({ length: 8 }).map((_, i) => {
          const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
          const x = 320 + Math.cos(a) * 200, y = 320 + Math.sin(a) * 200;
          return (
            <g key={i} transform={`translate(${x}, ${y}) rotate(${(a * 180 / Math.PI) + 90})`}>
              <polygon points="0,-4 3.5,3 -3.5,3" fill="rgba(180, 220, 240, 0.85)" />
            </g>
          );
        })}
      </g>

      {/* inner ring — vermilion/amber heptagram, CW */}
      <g style={{ transformOrigin: '320px 320px', animation: 'sigilSpinCW 18s linear infinite' }}>
        <circle cx="320" cy="320" r="140" fill="none" stroke="url(#ringVerm)" strokeWidth="0.5" opacity="0.7" />
        {/* heptagram */}
        <polygon
          points={Array.from({ length: 7 }).map((_, i) => {
            const a = (i * 3 / 7) * Math.PI * 2 - Math.PI / 2;
            return `${320 + Math.cos(a) * 130},${320 + Math.sin(a) * 130}`;
          }).join(' ')}
          fill="none"
          stroke="rgba(232, 168, 84, 0.7)"
          strokeWidth="0.6"
          strokeLinejoin="round"
          filter="url(#glow)"
        />
        {/* heptagon — soft */}
        <polygon
          points={Array.from({ length: 7 }).map((_, i) => {
            const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
            return `${320 + Math.cos(a) * 130},${320 + Math.sin(a) * 130}`;
          }).join(' ')}
          fill="none"
          stroke="rgba(208, 76, 60, 0.4)"
          strokeWidth="0.4"
          strokeLinejoin="round"
        />
        {/* point markers */}
        {Array.from({ length: 7 }).map((_, i) => {
          const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
          const x = 320 + Math.cos(a) * 130, y = 320 + Math.sin(a) * 130;
          return (
            <g key={i}>
              <circle cx={x} cy={y} r="3" fill="rgba(255, 220, 160, 0.95)" filter="url(#glow)" />
              <circle cx={x} cy={y} r="1.2" fill="rgba(255, 245, 220, 1)" />
            </g>
          );
        })}
      </g>

      {/* center seal — square within circle (chinese seal aesthetic) — fades on ignite */}
      <g style={{ opacity: phase >= 4 ? 0 : 1, transition: 'opacity 0.8s ease' }}>
        <circle cx="320" cy="320" r="68" fill="none" stroke="rgba(220, 188, 130, 0.4)" strokeWidth="0.6" />
        <circle cx="320" cy="320" r="56" fill="none" stroke="rgba(208, 76, 60, 0.55)" strokeWidth="0.4" />
        <rect x="290" y="290" width="60" height="60" fill="none" stroke="rgba(208, 76, 60, 0.6)" strokeWidth="0.5"
              style={{ transformOrigin: '320px 320px', animation: 'sealPulse 4s ease-in-out infinite' }} />
        {/* central glyph — stylized 夜 dot */}
        <circle cx="320" cy="320" r="3.5" fill="rgba(255, 220, 160, 0.95)" filter="url(#glow)" />
      </g>
    </svg>
  );

  // Petal halo bursts at ignition (phase 4)
  const petals = phase >= 4 && phase < 5 ? Array.from({ length: 12 }).map((_, i) => {
    const angle = (i / 12) * 360;
    const colors = ['rgba(220, 188, 130, 0.7)', 'rgba(232, 168, 84, 0.65)', 'rgba(208, 76, 60, 0.5)', 'rgba(110, 188, 210, 0.45)'];
    const c = colors[i % colors.length];
    return (
      <div key={i} style={{
        position: 'absolute', left: '50%', top: '50%',
        width: 0, height: 0,
        transform: `rotate(${angle}deg)`,
        pointerEvents: 'none',
      }}>
        <div style={{
          position: 'absolute',
          width: 4, height: 180,
          left: -2, top: -180,
          background: `linear-gradient(to top, transparent, ${c} 60%, transparent)`,
          animation: `petalBurst 1.6s cubic-bezier(.2,.7,.3,1) forwards`,
          animationDelay: `${i * 0.04}s`,
          opacity: 0,
          transformOrigin: '50% 100%',
        }} />
      </div>
    );
  }) : null;

  return (
    <div
      onClick={skip}
      style={{
        position: 'absolute', inset: 0, zIndex: 20,
        background: '#000',
        cursor: 'pointer',
        opacity: phase === 6 ? 0 : 1,
        transition: 'opacity 0.6s ease',
        overflow: 'hidden',
      }}
    >
      {/* base radial wash — shifts with phase */}
      <div style={{
        position: 'absolute', inset: 0,
        background: phase >= 4
          ? 'radial-gradient(ellipse at 50% 50%, rgba(48, 28, 18, 0.85), rgba(8,4,12,1) 70%)'
          : phase >= 3
            ? 'radial-gradient(ellipse at 50% 50%, rgba(20, 16, 32, 0.7), rgba(4,4,10,1) 75%)'
            : phase >= 2
              ? 'radial-gradient(ellipse at 50% 50%, rgba(14, 12, 22, 0.6), rgba(2,2,6,1) 80%)'
              : 'radial-gradient(ellipse at 50% 50%, rgba(8, 6, 12, 0.4), rgba(0,0,0,1) 85%)',
        transition: 'background 1.8s ease',
      }} />

      {/* breathing ink-wash canvas — multi-color radial layers */}
      <canvas
        ref={inkRef}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          opacity: phase >= 1 && phase < 6 ? 1 : 0,
          transition: 'opacity 1.2s ease',
          pointerEvents: 'none',
          mixBlendMode: 'screen',
        }}
      />

      {/* star map */}
      <div style={{
        position: 'absolute', inset: 0,
        opacity: phase >= 2 && phase < 5 ? 1 : (phase >= 5 ? 0.3 : 0),
        transition: 'opacity 1.4s ease',
        pointerEvents: 'none',
      }}>
        {stars.map((s, i) => {
          const color = s.hue === 'vermilion' ? 'rgba(232, 168, 84, 0.9)'
                      : s.hue === 'cyan'      ? 'rgba(180, 220, 240, 0.85)'
                      :                          'rgba(245, 232, 208, 0.85)';
          return (
            <div key={i} style={{
              position: 'absolute',
              left: `${s.x}%`, top: `${s.y}%`,
              width: s.size * 2, height: s.size * 2,
              borderRadius: '50%',
              background: color,
              boxShadow: `0 0 ${s.size * 6}px ${s.size * 1.5}px ${color}`,
              animation: `starTwinkle ${2.4 + Math.random() * 2}s ease-in-out ${s.delay}s infinite`,
            }} />
          );
        })}
        {/* constellation lines */}
        <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
          {lines.map((L, i) => (
            <line key={i}
                  x1={`${L.x1}%`} y1={`${L.y1}%`}
                  x2={`${L.x2}%`} y2={`${L.y2}%`}
                  stroke="rgba(180, 200, 230, 0.18)"
                  strokeWidth="0.4"
                  style={{
                    strokeDasharray: 200,
                    strokeDashoffset: phase >= 2 ? 0 : 200,
                    transition: `stroke-dashoffset 2.5s ease ${L.delay}s`,
                  }} />
          ))}
        </svg>
      </div>

      {/* heartbeat ember (phase 1) */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        width: 16, height: 16, borderRadius: 8,
        background: 'rgba(255, 220, 170, 0.95)',
        boxShadow: '0 0 30px 8px rgba(232, 168, 84, 0.7), 0 0 80px 22px rgba(208, 76, 60, 0.35), 0 0 160px 50px rgba(78, 92, 168, 0.18)',
        opacity: phase === 1 ? 1 : (phase === 2 ? 0.5 : phase === 3 ? 0.2 : 0),
        animation: phase === 1 ? 'emberBeat 1.5s ease-in-out' : 'none',
        transition: 'opacity 1.5s ease',
        pointerEvents: 'none',
      }} />

      {/* multi-color ripples on phase 2-3 */}
      {phase >= 2 && phase < 5 && (
        <>
          {[
            { d: 0, color: 'rgba(220, 188, 130, 0.55)' },
            { d: 0.7, color: 'rgba(110, 188, 210, 0.4)' },
            { d: 1.4, color: 'rgba(208, 76, 60, 0.35)' },
            { d: 2.1, color: 'rgba(245, 232, 208, 0.3)' },
          ].map((r, i) => (
            <div key={i} style={{
              position: 'absolute', left: '50%', top: '50%',
              transform: 'translate(-50%, -50%)',
              width: 60, height: 60, borderRadius: '50%',
              border: `0.6px solid ${r.color}`,
              animation: `ripple 3.6s ${r.d}s ease-out infinite`,
              pointerEvents: 'none',
              ['--ripple-color']: r.color,
            }} />
          ))}
        </>
      )}

      {/* sigil */}
      {sigil}

      {/* sparks at ignition */}
      <canvas
        ref={sparksRef}
        style={{
          position: 'absolute', inset: 0,
          width: '100%', height: '100%',
          pointerEvents: 'none',
          opacity: phase >= 4 ? 1 : 0,
          transition: 'opacity 0.4s ease',
        }}
      />

      {/* petal burst at ignition */}
      {petals}

      {/* central candle flame after ignition */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: 'translate(-50%, -50%)',
        opacity: phase >= 4 && phase < 6 ? 1 : 0,
        transition: 'opacity 1.2s ease',
        pointerEvents: 'none',
      }}>
        <div style={{
          width: 10, height: 10, borderRadius: 5,
          background: 'rgba(255, 240, 200, 1)',
          boxShadow: `
            0 0 22px 5px rgba(255, 200, 130, 0.9),
            0 0 70px 22px rgba(232, 130, 70, 0.55),
            0 0 160px 60px rgba(132, 70, 110, 0.35),
            0 0 280px 100px rgba(78, 92, 168, 0.18)
          `,
          animation: 'flameFlicker 2.4s ease-in-out infinite',
        }} />
      </div>

      {/* TITLE — calligraphic reveal */}
      <div style={{
        position: 'absolute', left: '50%', top: '50%',
        transform: phase >= 5
          ? 'translate(-50%, -50%) translateY(0)'
          : 'translate(-50%, -50%) translateY(24px)',
        opacity: phase >= 5 ? 1 : 0,
        filter: phase >= 5 ? 'blur(0)' : 'blur(10px)',
        transition: 'opacity 2s ease, transform 2.2s cubic-bezier(.2,.6,.2,1), filter 2s ease',
        textAlign: 'center',
        pointerEvents: 'none',
      }}>
        {/* SVG calligraphy with stroke-draw */}
        <svg width="380" height="160" viewBox="0 0 380 160"
             style={{ display: 'block', margin: '0 auto', overflow: 'visible' }}>
          <defs>
            <linearGradient id="titleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%"   stopColor="rgba(245, 232, 208, 1)" />
              <stop offset="40%"  stopColor="rgba(232, 168, 84, 1)" />
              <stop offset="80%"  stopColor="rgba(208, 76, 60, 1)" />
              <stop offset="100%" stopColor="rgba(132, 70, 110, 1)" />
            </linearGradient>
            <filter id="titleGlow" x="-30%" y="-30%" width="160%" height="160%">
              <feGaussianBlur stdDeviation="3" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          <text
            x="190" y="100"
            textAnchor="middle"
            fill="url(#titleGrad)"
            fontFamily='"Noto Serif SC", Georgia, serif'
            fontSize="84"
            fontWeight="500"
            letterSpacing="20"
            style={{
              filter: 'url(#titleGlow)',
              animation: phase >= 5 ? 'titleBreathe 4s ease-in-out infinite 1.5s' : 'none',
              paintOrder: 'stroke',
              stroke: 'rgba(245, 232, 208, 0.25)',
              strokeWidth: 0.4,
            }}
          >夜阑</text>

          {/* underline flourish */}
          <line x1="80" y1="128" x2="300" y2="128"
                stroke="url(#titleGrad)" strokeWidth="0.8"
                style={{
                  strokeDasharray: 220,
                  strokeDashoffset: phase >= 5 ? 0 : 220,
                  transition: 'stroke-dashoffset 2s ease 0.8s',
                  opacity: 0.7,
                }} />
          {/* ornaments left + right */}
          <g style={{ opacity: phase >= 5 ? 1 : 0, transition: 'opacity 1.4s ease 1.2s' }}>
            <circle cx="60" cy="128" r="2" fill="rgba(232, 168, 84, 0.9)" />
            <circle cx="320" cy="128" r="2" fill="rgba(232, 168, 84, 0.9)" />
            <line x1="40" y1="128" x2="56" y2="128" stroke="rgba(220, 188, 130, 0.6)" strokeWidth="0.5" />
            <line x1="324" y1="128" x2="340" y2="128" stroke="rgba(220, 188, 130, 0.6)" strokeWidth="0.5" />
          </g>
        </svg>

        <div style={{
          marginTop: -8,
          fontSize: 'calc(11px * var(--type-scale))', letterSpacing: 12,
          color: 'rgba(180, 200, 230, 0.65)',
          fontFamily: 'Inter, sans-serif',
          opacity: phase >= 5 ? 1 : 0,
          transform: phase >= 5 ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 1.6s ease 1s, transform 1.6s ease 1s',
          paddingLeft: 12,
        }}>
          Y　E　L　A　N
        </div>
        <div style={{
          marginTop: 22,
          fontSize: 'calc(10px * var(--type-scale))', letterSpacing: 6,
          color: 'rgba(220, 188, 130, 0.45)',
          fontFamily: '"Noto Serif SC", serif',
          opacity: phase >= 5 ? 1 : 0,
          transition: 'opacity 1.6s ease 1.6s',
          fontStyle: 'italic',
        }}>
          ·　夜　未　央　·
        </div>
      </div>

      {/* skip hint */}
      <div style={{
        position: 'absolute', bottom: 40, left: '50%',
        transform: 'translateX(-50%)',
        fontSize: 'calc(10px * var(--type-scale))', letterSpacing: 4,
        color: 'rgba(140, 126, 110, 0.45)',
        opacity: phase >= 2 && phase < 6 ? 1 : 0,
        transition: 'opacity 2s ease',
        pointerEvents: 'none',
      }}>
        点击跳过
      </div>

      {/* vignette */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse at 50% 50%, transparent 40%, rgba(0,0,0,0.6) 100%)',
        pointerEvents: 'none',
      }} />
    </div>
  );
}

window.IntroScene = IntroScene;
