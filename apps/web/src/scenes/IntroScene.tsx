// 来源: 快速启动.html (IntroScene 部分)
// 职责: 题字浮现 / 烛火点燃 / 开始的引导

import { useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../stores/sessionStore';
import styles from './IntroScene.module.css';

export function IntroScene() {
  const [phase, setPhase] = useState(0);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const sparksRef = useRef<HTMLCanvasElement>(null);
  const goOpening = useSessionStore((s) => s.goOpening);

  const stars = useMemo(
    () =>
      Array.from({ length: 60 }, () => ({
        x: 50 + (Math.random() - 0.5) * 80,
        y: 50 + (Math.random() - 0.5) * 70,
        size: 0.4 + Math.random() * 1.4,
        delay: Math.random() * 1.2,
        hue: Math.random() < 0.15 ? 'v' : Math.random() < 0.4 ? 'c' : 'p',
      })),
    [],
  );

  useEffect(() => {
    const ts = [
      setTimeout(() => setPhase(1), 120),
      setTimeout(() => setPhase(2), 1700),
      setTimeout(() => setPhase(3), 3300),
      setTimeout(() => setPhase(4), 5600),
      setTimeout(() => setPhase(5), 7400),
      setTimeout(() => setPhase(6), 9800),
      setTimeout(goOpening, 10400),
    ];
    return () => ts.forEach(clearTimeout);
  }, [goOpening]);

  const skip = () => {
    setPhase(6);
    setTimeout(goOpening, 500);
  };

  // Ink wash canvas
  useEffect(() => {
    if (phase < 1) return;
    const cvs = inkRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = cvs.clientWidth * dpr;
    cvs.height = cvs.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    const W = cvs.clientWidth;
    const H = cvs.clientHeight;
    const cx = W / 2;
    const cy = H / 2;
    const t0 = performance.now();
    let raf = 0;
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.clearRect(0, 0, W, H);
      const layers = [
        { r: 220 + Math.sin(t * 0.7) * 30, alpha: 0.1, color: '78,92,168' },
        { r: 360 + Math.cos(t * 0.5) * 40, alpha: 0.06, color: '132,70,110' },
        { r: 480 + Math.sin(t * 0.4 + 1) * 50, alpha: 0.04, color: '208,76,60' },
      ];
      for (const L of layers) {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, L.r);
        g.addColorStop(0, `rgba(${L.color},${L.alpha})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Sparks canvas (ignition)
  useEffect(() => {
    if (phase !== 4) return;
    const cvs = sparksRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cvs.width = cvs.clientWidth * dpr;
    cvs.height = cvs.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    const W = cvs.clientWidth;
    const H = cvs.clientHeight;
    const cx = W / 2;
    const cy = H / 2;
    const colors = [
      [255, 220, 160],
      [232, 168, 84],
      [208, 110, 80],
      [245, 232, 208],
      [180, 200, 230],
    ] as const;
    const sparks = Array.from({ length: 120 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 5;
      return {
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 0.5,
        life: 1,
        decay: 0.006 + Math.random() * 0.012,
        r: 0.6 + Math.random() * 1.8,
        c: colors[Math.floor(Math.random() * colors.length)] ?? colors[0],
      };
    });
    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      for (const s of sparks) {
        if (s.life <= 0) continue;
        alive++;
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.035;
        s.vx *= 0.992;
        s.life -= s.decay;
        const a = Math.max(0, s.life);
        const hr = s.r * 6;
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, hr);
        g.addColorStop(0, `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${a * 0.85})`);
        g.addColorStop(0.4, `rgba(${s.c[0]},${s.c[1]},${s.c[2]},${a * 0.3})`);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, hr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(${Math.min(255, s.c[0] + 30)},${Math.min(255, s.c[1] + 40)},${Math.min(255, s.c[2] + 50)},${a})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx.fill();
      }
      if (alive > 0) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  const sigilOpacity = phase >= 3 ? (phase >= 5 ? 0 : 1) : 0;
  const sigilScale = phase >= 3 ? 1 : 0.55;
  const sigilBlur = phase >= 5 ? 'blur(10px)' : 'blur(0)';

  return (
    <div
      className={styles.root}
      onClick={skip}
      style={{ opacity: phase === 6 ? 0 : 1, transition: 'opacity .6s ease', overflow: 'hidden' }}
    >
      {/* base radial wash */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            phase >= 4
              ? 'radial-gradient(ellipse at 50% 50%, rgba(48,28,18,.85), rgba(8,4,12,1) 70%)'
              : phase >= 3
                ? 'radial-gradient(ellipse at 50% 50%, rgba(20,16,32,.7), rgba(4,4,10,1) 75%)'
                : phase >= 2
                  ? 'radial-gradient(ellipse at 50% 50%, rgba(14,12,22,.6), rgba(2,2,6,1) 80%)'
                  : 'radial-gradient(ellipse at 50% 50%, rgba(8,6,12,.4), rgba(0,0,0,1) 85%)',
          transition: 'background 1.8s ease',
        }}
      />

      {/* ink wash */}
      <canvas
        ref={inkRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: phase >= 1 && phase < 6 ? 1 : 0,
          transition: 'opacity 1.2s ease',
          pointerEvents: 'none',
          mixBlendMode: 'screen',
        }}
      />

      {/* star map */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          opacity: phase >= 2 && phase < 5 ? 1 : phase >= 5 ? 0.3 : 0,
          transition: 'opacity 1.4s ease',
          pointerEvents: 'none',
        }}
      >
        {stars.map((s, i) => {
          const color =
            s.hue === 'v'
              ? 'rgba(232,168,84,.9)'
              : s.hue === 'c'
                ? 'rgba(180,220,240,.85)'
                : 'rgba(245,232,208,.85)';
          return (
            <div
              key={i}
              style={{
                position: 'absolute',
                left: `${s.x}%`,
                top: `${s.y}%`,
                width: s.size * 2,
                height: s.size * 2,
                borderRadius: '50%',
                background: color,
                boxShadow: `0 0 ${s.size * 6}px ${s.size * 1.5}px ${color}`,
                animation: `starTwinkle ${2.4 + Math.random() * 2}s ease-in-out ${s.delay}s infinite`,
              }}
            />
          );
        })}
      </div>

      {/* ember */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%,-50%)',
          width: 16,
          height: 16,
          borderRadius: 8,
          background: 'rgba(255,220,170,.95)',
          boxShadow:
            '0 0 30px 8px rgba(232,168,84,.7), 0 0 80px 22px rgba(208,76,60,.35), 0 0 160px 50px rgba(78,92,168,.18)',
          opacity: phase === 1 ? 1 : phase === 2 ? 0.5 : phase === 3 ? 0.2 : 0,
          animation: phase === 1 ? 'emberBeat 1.5s ease-in-out' : 'none',
          transition: 'opacity 1.5s ease',
          pointerEvents: 'none',
        }}
      />

      {/* ripples */}
      {phase >= 2 &&
        phase < 5 &&
        [
          { d: 0, c: 'rgba(220,188,130,.55)' },
          { d: 0.7, c: 'rgba(110,188,210,.4)' },
          { d: 1.4, c: 'rgba(208,76,60,.35)' },
          { d: 2.1, c: 'rgba(245,232,208,.3)' },
        ].map((r, i) => (
          <div
            key={i}
            style={{
              position: 'absolute',
              left: '50%',
              top: '50%',
              transform: 'translate(-50%,-50%)',
              width: 60,
              height: 60,
              borderRadius: '50%',
              border: `.6px solid ${r.c}`,
              animation: `ripple 3.6s ${r.d}s ease-out infinite`,
              pointerEvents: 'none',
            }}
          />
        ))}

      {/* sigil */}
      <div
        className={styles.sigilWrap}
        style={{ opacity: sigilOpacity, transform: `translate(-50%,-50%) scale(${sigilScale})`, filter: sigilBlur }}
      >
        <svg width="640" height="640" viewBox="0 0 640 640" style={{ pointerEvents: 'none' }}>
          <defs>
            <linearGradient id="ringGold" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(245,232,208,.9)" />
              <stop offset="100%" stopColor="rgba(160,110,70,.7)" />
            </linearGradient>
            <linearGradient id="ringIndigo" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(110,188,210,.8)" />
              <stop offset="100%" stopColor="rgba(78,92,168,.7)" />
            </linearGradient>
            <radialGradient id="halo1" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="rgba(232,168,84,0.16)" />
              <stop offset="60%" stopColor="rgba(132,70,110,0.06)" />
              <stop offset="100%" stopColor="rgba(0,0,0,0)" />
            </radialGradient>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="2.5" result="b" />
              <feMerge>
                <feMergeNode in="b" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <circle cx="320" cy="320" r="300" fill="url(#halo1)" />
          <g style={{ transformOrigin: '320px 320px', animation: 'sigilSpinCW 28s linear infinite' }}>
            <circle cx="320" cy="320" r="270" fill="none" stroke="url(#ringGold)" strokeWidth=".6" opacity=".7" />
            {Array.from({ length: 36 }).map((_, i) => {
              const a = (i / 36) * Math.PI * 2;
              const long = i % 3 === 0;
              const r1 = 270;
              const r2 = long ? 245 : 256;
              return (
                <line
                  key={i}
                  x1={320 + Math.cos(a) * r1}
                  y1={320 + Math.sin(a) * r1}
                  x2={320 + Math.cos(a) * r2}
                  y2={320 + Math.sin(a) * r2}
                  stroke={long ? 'rgba(245,232,208,.85)' : 'rgba(220,188,130,.55)'}
                  strokeWidth={long ? 0.8 : 0.5}
                />
              );
            })}
          </g>
          <g style={{ transformOrigin: '320px 320px', animation: 'sigilSpinCCW 22s linear infinite' }}>
            <circle cx="320" cy="320" r="200" fill="none" stroke="url(#ringIndigo)" strokeWidth=".5" opacity=".65" />
            {Array.from({ length: 8 }).map((_, i) => {
              const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
              const x = 320 + Math.cos(a) * 200;
              const y = 320 + Math.sin(a) * 200;
              return (
                <g key={i} transform={`translate(${x},${y}) rotate(${(a * 180) / Math.PI + 90})`}>
                  <polygon points="0,-4 3.5,3 -3.5,3" fill="rgba(180,220,240,.85)" />
                </g>
              );
            })}
          </g>
          <g style={{ transformOrigin: '320px 320px', animation: 'sigilSpinCW 18s linear infinite' }}>
            <circle cx="320" cy="320" r="140" fill="none" stroke="rgba(232,168,84,.7)" strokeWidth=".5" opacity=".7" />
            <polygon
              points={Array.from({ length: 7 })
                .map((_, i) => {
                  const a = ((i * 3) / 7) * Math.PI * 2 - Math.PI / 2;
                  return `${320 + Math.cos(a) * 130},${320 + Math.sin(a) * 130}`;
                })
                .join(' ')}
              fill="none"
              stroke="rgba(232,168,84,.7)"
              strokeWidth=".6"
              filter="url(#glow)"
            />
            {Array.from({ length: 7 }).map((_, i) => {
              const a = (i / 7) * Math.PI * 2 - Math.PI / 2;
              const x = 320 + Math.cos(a) * 130;
              const y = 320 + Math.sin(a) * 130;
              return (
                <g key={i}>
                  <circle cx={x} cy={y} r="3" fill="rgba(255,220,160,.95)" filter="url(#glow)" />
                </g>
              );
            })}
          </g>
          <g style={{ opacity: phase >= 4 ? 0 : 1, transition: 'opacity .8s ease' }}>
            <circle cx="320" cy="320" r="68" fill="none" stroke="rgba(220,188,130,.4)" strokeWidth=".6" />
            <rect
              x="290"
              y="290"
              width="60"
              height="60"
              fill="none"
              stroke="rgba(208,76,60,.6)"
              strokeWidth=".5"
              style={{ transformOrigin: '320px 320px', animation: 'sealPulse 4s ease-in-out infinite' }}
            />
            <circle cx="320" cy="320" r="3.5" fill="rgba(255,220,160,.95)" filter="url(#glow)" />
          </g>
        </svg>
      </div>

      {/* sparks */}
      <canvas
        ref={sparksRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          pointerEvents: 'none',
          opacity: phase >= 4 ? 1 : 0,
          transition: 'opacity .4s ease',
        }}
      />

      {/* petal bursts */}
      {phase >= 4 &&
        phase < 5 &&
        Array.from({ length: 12 }).map((_, i) => {
          const angle = (i / 12) * 360;
          const colors = [
            'rgba(220,188,130,.7)',
            'rgba(232,168,84,.65)',
            'rgba(208,76,60,.5)',
            'rgba(110,188,210,.45)',
          ] as const;
          const color = colors[i % colors.length] ?? colors[0];
          return (
            <div key={i} style={{ position: 'absolute', left: '50%', top: '50%', transform: `rotate(${angle}deg)`, pointerEvents: 'none' }}>
              <div
                style={{
                  position: 'absolute',
                  width: 4,
                  height: 180,
                  left: -2,
                  top: -180,
                  background: `linear-gradient(to top, transparent, ${color} 60%, transparent)`,
                  animation: 'petalBurst 1.6s cubic-bezier(.2,.7,.3,1) forwards',
                  animationDelay: `${i * 0.04}s`,
                  opacity: 0,
                  transformOrigin: '50% 100%',
                }}
              />
            </div>
          );
        })}

      {/* candle flame */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: 'translate(-50%,-50%)',
          opacity: phase >= 4 && phase < 6 ? 1 : 0,
          transition: 'opacity 1.2s ease',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            background: 'rgba(255,240,200,1)',
            boxShadow:
              '0 0 22px 5px rgba(255,200,130,.9), 0 0 70px 22px rgba(232,130,70,.55), 0 0 160px 60px rgba(132,70,110,.35), 0 0 280px 100px rgba(78,92,168,.18)',
            animation: 'flameFlicker 2.4s ease-in-out infinite',
          }}
        />
      </div>

      {/* TITLE */}
      <div
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          transform: phase >= 5 ? 'translate(-50%,-50%) translateY(0)' : 'translate(-50%,-50%) translateY(24px)',
          opacity: phase >= 5 ? 1 : 0,
          filter: phase >= 5 ? 'blur(0)' : 'blur(10px)',
          transition: 'opacity 2s ease, transform 2.2s cubic-bezier(.2,.6,.2,1), filter 2s ease',
          textAlign: 'center',
          pointerEvents: 'none',
        }}
      >
        <svg width="380" height="160" viewBox="0 0 380 160" style={{ display: 'block', margin: '0 auto', overflow: 'visible' }}>
          <defs>
            <linearGradient id="titleGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="rgba(245,232,208,1)" />
              <stop offset="40%" stopColor="rgba(232,168,84,1)" />
              <stop offset="80%" stopColor="rgba(208,76,60,1)" />
              <stop offset="100%" stopColor="rgba(132,70,110,1)" />
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
            x="190"
            y="100"
            textAnchor="middle"
            fill="url(#titleGrad)"
            fontFamily="Noto Serif SC, Georgia, serif"
            fontSize="84"
            fontWeight="500"
            letterSpacing="20"
            style={{ filter: 'url(#titleGlow)', animation: phase >= 5 ? 'titleBreathe 4s ease-in-out infinite 1.5s' : 'none' }}
          >
            夜阑
          </text>
          <line
            x1="80"
            y1="128"
            x2="300"
            y2="128"
            stroke="url(#titleGrad)"
            strokeWidth=".8"
            style={{ strokeDasharray: 220, strokeDashoffset: phase >= 5 ? 0 : 220, transition: 'stroke-dashoffset 2s ease .8s', opacity: 0.7 }}
          />
        </svg>
        <div
          style={{
            marginTop: -8,
            fontSize: 'var(--fs-xxs)',
            letterSpacing: 12,
            color: 'rgba(180,200,230,.65)',
            fontFamily: 'Inter, sans-serif',
            opacity: phase >= 5 ? 1 : 0,
            transition: 'opacity 1.6s ease 1s',
            paddingLeft: 12,
          }}
        >
          Y E L A N
        </div>
        <div
          style={{
            marginTop: 22,
            fontSize: 'calc(10px * var(--type-scale))',
            letterSpacing: 6,
            color: 'rgba(220,188,130,.45)',
            fontFamily: 'Noto Serif SC, serif',
            opacity: phase >= 5 ? 1 : 0,
            transition: 'opacity 1.6s ease 1.6s',
            fontStyle: 'italic',
          }}
        >
          · 夜 未 央 ·
        </div>
      </div>

      {/* skip hint */}
      <div
        style={{
          position: 'absolute',
          bottom: 40,
          left: '50%',
          transform: 'translateX(-50%)',
          fontSize: 'var(--fs-xxs)',
          letterSpacing: 4,
          color: 'rgba(140,126,110,.45)',
          opacity: phase >= 2 && phase < 6 ? 1 : 0,
          transition: 'opacity 2s ease',
          pointerEvents: 'none',
        }}
      >
        点击跳过
      </div>
    </div>
  );
}
