// Main app — orchestrates scenes, particles, tweaks, achievements

const { useState: useS, useEffect: useE } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "stage": "auto",
  "candle": "auto",
  "particle": 1.0
}/*EDITMODE-END*/;

function App() {
  const [scene, setScene] = useS('intro'); // intro | opening | select | chat | end
  const [greeting, setGreeting] = useS('');
  const [character, setCharacter] = useS(null);
  const [achievement, setAchievement] = useS(null);
  const [autoStage, setAutoStage] = useS('daily');
  const [autoCandle, setAutoCandle] = useS('full');
  const [drawer, setDrawer] = useS(null);
  const [boundary, setBoundary] = useS(2);

  const [tweaks, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const stage = tweaks.stage === 'auto' ? autoStage : tweaks.stage;
  const candle = tweaks.candle === 'auto' ? autoCandle : tweaks.candle;

  const restart = () => {
    setScene('intro'); setCharacter(null); setGreeting('');
    setAutoStage('daily'); setAutoCandle('full');
  };

  return (
    <div style={{
      width: '100vw', height: '100vh', position: 'relative',
      background: '#0a0a0f',
    }}>
      {/* deep background gradient — subtly shifts with stage */}
      <div style={{
        position: 'absolute', inset: 0,
        background: stage === 'climax'
          ? 'radial-gradient(ellipse at 50% 60%, #1a1410 0%, #0a0a0f 60%)'
          : stage === 'rise'
            ? 'radial-gradient(ellipse at 50% 55%, #14110d 0%, #0a0a0f 65%)'
            : stage === 'after'
              ? 'radial-gradient(ellipse at 50% 50%, #0e0d10 0%, #0a0a0f 70%)'
              : 'radial-gradient(ellipse at 50% 50%, #0d0c10 0%, #0a0a0f 80%)',
        transition: 'background 3s ease',
        zIndex: 0,
      }} />

      <ParticleField stage={stage} intensity={tweaks.particle} candle={candle} />

      {scene === 'intro' && (
        <IntroScene onDone={() => setScene('opening')} />
      )}
      {scene === 'opening' && (
        <OpeningScene onEnter={(g) => { setGreeting(g); setScene('select'); }} />
      )}
      {scene === 'select' && (
        <CharacterSelect greeting={greeting} onPick={(c) => { setCharacter(c); setScene('chat'); }} />
      )}
      {scene === 'chat' && (
        <Conversation
          character={character}
          stage={stage}
          candle={candle}
          autoStage={tweaks.stage === 'auto'}
          autoCandle={tweaks.candle === 'auto'}
          onStageAuto={setAutoStage}
          onCandleAuto={setAutoCandle}
          onAchievement={(a) => setAchievement(a)}
          onCutoff={() => setScene('end')}
        />
      )}
      {scene === 'end' && (
        <NarrativeCutoff onRestart={restart} />
      )}

      <AchievementFlash ach={achievement} onDone={() => setAchievement(null)} />

      {(scene === 'chat' || scene === 'select') && (
        <DrawerRail open={!!drawer} onOpen={(id) => setDrawer(id)} />
      )}
      <DrawerShell
        openId={drawer}
        onClose={() => setDrawer(null)}
        candle={candle}
        onCandleChange={(c) => setAutoCandle(c)}
        narrativeBoundary={boundary}
        onBoundaryChange={setBoundary}
      />

      <TweaksPanel>
        <TweakSection label="叙事阶段">
          <TweakSelect
            label="Stage"
            value={tweaks.stage}
            onChange={(v) => setTweak('stage', v)}
            options={[
              { value: 'auto', label: '自动（随对话）' },
              { value: 'daily', label: '日常 · 舒展' },
              { value: 'rise', label: '推拉 · 收窄' },
              { value: 'climax', label: '高潮 · 最窄' },
              { value: 'after', label: '余韵 · 松开' },
            ]}
          />
        </TweakSection>
        <TweakSection label="烛光余额">
          <TweakSelect
            label="Candle"
            value={tweaks.candle}
            onChange={(v) => setTweak('candle', v)}
            options={[
              { value: 'auto', label: '自动' },
              { value: 'full', label: '充盈' },
              { value: 'mid', label: '渐晚' },
              { value: 'low', label: '将尽' },
            ]}
          />
        </TweakSection>
        <TweakSection label="粒子动效">
          <TweakSlider
            label="强度"
            value={tweaks.particle}
            min={0} max={2} step={0.1}
            onChange={(v) => setTweak('particle', v)}
          />
        </TweakSection>
        <TweakSection label="跳转">
          <TweakButton label="触发成就 · 深夜" onClick={() => setAchievement({ name: '深夜', desc: '凌晨四点，你还在。' })} />
          <TweakButton label="预览 · 叙事性截断" onClick={() => setScene('end')} />
          <TweakButton label="从头开始" onClick={restart} />
        </TweakSection>
        <TweakSection label="抽屉">
          <TweakButton label="打开 · 你"   onClick={() => setDrawer('you')} />
          <TweakButton label="打开 · 续夜" onClick={() => setDrawer('subs')} />
          <TweakButton label="打开 · 烛账" onClick={() => setDrawer('candle')} />
          <TweakButton label="打开 · 书阁" onClick={() => setDrawer('library')} />
          <TweakButton label="打开 · 记事" onClick={() => setDrawer('memory')} />
          <TweakButton label="打开 · 印"   onClick={() => setDrawer('seal')} />
          <TweakButton label="打开 · 一问" onClick={() => setDrawer('survey')} />
          <TweakButton label="打开 · 调息" onClick={() => setDrawer('breath')} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

// global styles
const styleEl = document.createElement('style');
styleEl.textContent = `
  @keyframes breathe {
    0%, 100% { text-shadow: 0 0 18px rgba(220, 188, 130, 0.32), 0 0 4px rgba(220, 188, 130, 0.22); }
    50%      { text-shadow: 0 0 28px rgba(220, 188, 130, 0.55), 0 0 10px rgba(220, 188, 130, 0.4); }
  }
  @keyframes candleFull {
    0%, 100% { opacity: 0.85; transform: scale(1); }
    50%      { opacity: 1;    transform: scale(1.15); }
  }
  @keyframes candleMid {
    0%, 100% { opacity: 0.7; transform: scale(0.95); }
    30%      { opacity: 1;   transform: scale(1.1); }
    60%      { opacity: 0.6; transform: scale(0.9); }
  }
  @keyframes candleLow {
    0%, 100% { opacity: 0.5; transform: scale(0.85); }
    35%      { opacity: 0.95; transform: scale(1.05); }
    70%      { opacity: 0.3; transform: scale(0.8); }
  }
  @keyframes typingDot {
    0%, 100% { opacity: 0.2; transform: translateY(0); }
    50%      { opacity: 1;   transform: translateY(-3px); }
  }
  @keyframes achFlash {
    0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.92); filter: blur(8px); }
    18%  { opacity: 1; transform: translate(-50%, -50%) scale(1);    filter: blur(0); }
    78%  { opacity: 1; transform: translate(-50%, -50%) scale(1);    filter: blur(0); }
    100% { opacity: 0; transform: translate(-50%, -52%) scale(1.02); filter: blur(3px); }
  }
  @keyframes fadeUp {
    0%   { opacity: 0; transform: translateY(14px); filter: blur(3px); }
    100% { opacity: 1; transform: translateY(0);    filter: blur(0); }
  }
  @keyframes sigilSpinCW  { from { transform: rotate(0deg); }    to { transform: rotate(360deg); } }
  @keyframes sigilSpinCCW { from { transform: rotate(0deg); }    to { transform: rotate(-360deg); } }
  @keyframes ripple {
    0%   { width: 60px;  height: 60px;  opacity: 0.6; border-color: rgba(220, 188, 130, 0.5); }
    100% { width: 520px; height: 520px; opacity: 0;   border-color: rgba(220, 188, 130, 0); }
  }
  @keyframes emberBeat {
    0%, 100% { transform: translate(-50%, -50%) scale(0.85); }
    20%      { transform: translate(-50%, -50%) scale(1.15); }
    50%      { transform: translate(-50%, -50%) scale(0.9); }
    75%      { transform: translate(-50%, -50%) scale(1.1); }
  }
  @keyframes inkBloom {
    0%   { transform: translate(-50%, -50%) scale(0.4); opacity: 0; }
    30%  { opacity: 1; }
    100% { transform: translate(-50%, -50%) scale(1.4); opacity: 0; }
  }
  @keyframes flameFlicker {
    0%, 100% { transform: scale(1)    translateY(0); opacity: 0.95; }
    25%      { transform: scale(1.15) translateY(-1px); opacity: 1; }
    55%      { transform: scale(0.92) translateY(1px); opacity: 0.85; }
    80%      { transform: scale(1.08) translateY(0); opacity: 1; }
  }
  @keyframes titleBreathe {
    0%, 100% { filter: url(#titleGlow) drop-shadow(0 0 12px rgba(232, 168, 84, 0.4)); }
    50%      { filter: url(#titleGlow) drop-shadow(0 0 22px rgba(232, 168, 84, 0.7)) drop-shadow(0 0 6px rgba(245, 232, 208, 0.5)); }
  }
  @keyframes starTwinkle {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50%      { opacity: 1;   transform: scale(1.1); }
  }
  @keyframes sealPulse {
    0%, 100% { transform: rotate(0deg) scale(1); opacity: 0.6; }
    50%      { transform: rotate(45deg) scale(1.08); opacity: 0.85; }
  }
  @keyframes petalBurst {
    0%   { opacity: 0; transform: scaleY(0.1) translateY(60px); }
    25%  { opacity: 1; }
    100% { opacity: 0; transform: scaleY(1.6) translateY(-40px); }
  }
  ::-webkit-scrollbar { width: 0; height: 0; }
  textarea::placeholder { color: rgba(138, 126, 110, 0.4); }
  input::placeholder    { color: rgba(138, 126, 110, 0.4); }
`;
document.head.appendChild(styleEl);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
