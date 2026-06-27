// Layered ambient particles — 流萤 (fireflies), 烛火 (ember sparks), 墨晕 (ink blooms), 星屑 (stardust)
// Drives the "magical" feel; intensity is tunable.

const { useEffect, useRef } = React;

function ParticleField({ stage, intensity = 1, candle = 'full' }) {
  const canvasRef = useRef(null);
  const stateRef = useRef({ particles: [], blooms: [], t: 0 });

  useEffect(() => {
    const cvs = canvasRef.current;
    if (!cvs) return;
    const ctx = cvs.getContext('2d');
    let raf;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      cvs.width = cvs.clientWidth * dpr;
      cvs.height = cvs.clientHeight * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    window.addEventListener('resize', resize);

    // seed particles
    const seed = () => {
      const W = cvs.clientWidth, H = cvs.clientHeight;
      const baseCount = Math.round(36 * intensity);
      const arr = [];
      for (let i = 0; i < baseCount; i++) {
        arr.push({
          kind: Math.random() < 0.55 ? 'firefly' : (Math.random() < 0.5 ? 'ember' : 'dust'),
          x: Math.random() * W,
          y: Math.random() * H,
          vx: (Math.random() - 0.5) * 0.18,
          vy: -(0.05 + Math.random() * 0.25),
          r: 0.6 + Math.random() * 1.8,
          phase: Math.random() * Math.PI * 2,
          life: Math.random(),
          hueShift: Math.random() * 0.4,
        });
      }
      stateRef.current.particles = arr;
    };
    seed();

    const draw = () => {
      const W = cvs.clientWidth, H = cvs.clientHeight;
      ctx.clearRect(0, 0, W, H);
      stateRef.current.t += 0.016;
      const t = stateRef.current.t;

      // candle warmth tint based on state
      const warmth = candle === 'low' ? 0.45 : candle === 'mid' ? 0.75 : 1;
      const stageWarm = stage === 'climax' ? 1.15 : stage === 'rise' ? 1.05 : stage === 'after' ? 0.85 : 1;

      // ink blooms — slow expanding stains, more during climax
      stateRef.current.blooms = stateRef.current.blooms.filter(b => b.age < b.maxAge);
      if (stage === 'climax' && Math.random() < 0.02 * intensity) {
        stateRef.current.blooms.push({
          x: Math.random() * W, y: Math.random() * H,
          maxR: 80 + Math.random() * 140,
          age: 0, maxAge: 6 + Math.random() * 4,
        });
      } else if (stage === 'rise' && Math.random() < 0.008 * intensity) {
        stateRef.current.blooms.push({
          x: Math.random() * W, y: Math.random() * H,
          maxR: 60 + Math.random() * 80,
          age: 0, maxAge: 5,
        });
      }
      for (const b of stateRef.current.blooms) {
        b.age += 0.016;
        const k = b.age / b.maxAge;
        const r = b.maxR * (1 - Math.pow(1 - k, 3));
        const a = (1 - k) * 0.10 * warmth * stageWarm;
        const grad = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, r);
        grad.addColorStop(0, `rgba(160, 128, 96, ${a})`);
        grad.addColorStop(0.5, `rgba(120, 96, 72, ${a * 0.4})`);
        grad.addColorStop(1, `rgba(0,0,0,0)`);
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // particles
      for (const p of stateRef.current.particles) {
        p.x += p.vx;
        p.y += p.vy * (stage === 'after' ? 0.6 : 1);
        p.phase += 0.02 + Math.random() * 0.01;
        if (p.y < -10) { p.y = H + 10; p.x = Math.random() * W; }
        if (p.x < -10) p.x = W + 10;
        if (p.x > W + 10) p.x = -10;

        const flicker = 0.55 + 0.45 * Math.sin(p.phase + t * 1.2);
        const baseAlpha = (p.kind === 'firefly' ? 0.85 : p.kind === 'ember' ? 0.6 : 0.35);
        const alpha = baseAlpha * flicker * warmth * stageWarm * Math.min(1, intensity);

        // soft halo
        const haloR = p.r * (p.kind === 'firefly' ? 6 : 4);
        const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, haloR);
        if (p.kind === 'firefly') {
          grad.addColorStop(0, `rgba(220, 188, 130, ${alpha * 0.9})`);
          grad.addColorStop(0.4, `rgba(200, 160, 100, ${alpha * 0.4})`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
        } else if (p.kind === 'ember') {
          grad.addColorStop(0, `rgba(230, 150, 90, ${alpha * 0.8})`);
          grad.addColorStop(0.5, `rgba(180, 110, 70, ${alpha * 0.3})`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
        } else {
          grad.addColorStop(0, `rgba(200, 200, 220, ${alpha * 0.5})`);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
        }
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(p.x, p.y, haloR, 0, Math.PI * 2);
        ctx.fill();

        // bright core
        ctx.fillStyle = p.kind === 'firefly'
          ? `rgba(248, 220, 160, ${alpha})`
          : p.kind === 'ember'
            ? `rgba(255, 180, 110, ${alpha * 0.9})`
            : `rgba(220, 220, 240, ${alpha * 0.7})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [intensity, stage, candle]);

  // re-seed when intensity changes drastically
  useEffect(() => {
    if (canvasRef.current) {
      const W = canvasRef.current.clientWidth, H = canvasRef.current.clientHeight;
      const target = Math.round(36 * intensity);
      const cur = stateRef.current.particles.length;
      if (target > cur) {
        for (let i = 0; i < target - cur; i++) {
          stateRef.current.particles.push({
            kind: Math.random() < 0.55 ? 'firefly' : (Math.random() < 0.5 ? 'ember' : 'dust'),
            x: Math.random() * W, y: Math.random() * H,
            vx: (Math.random() - 0.5) * 0.18, vy: -(0.05 + Math.random() * 0.25),
            r: 0.6 + Math.random() * 1.8,
            phase: Math.random() * Math.PI * 2,
            life: Math.random(),
          });
        }
      } else {
        stateRef.current.particles.length = target;
      }
    }
  }, [intensity]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 1,
      }}
    />
  );
}

window.ParticleField = ParticleField;
