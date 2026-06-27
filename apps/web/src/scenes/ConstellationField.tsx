import React from 'react';
import type { Constellation } from './CharacterSelect.constellation';
import styles from './CharacterSelect.module.css';

interface ConstellationFieldProps {
  constellation: Constellation;
  intensity: number; // 0..1 to control opacity based on slot offset
  active: boolean;   // center card gets full animation, sides get static or reduced
  tier?: number;     // 0 中心 / 1 两侧 / 2 远端：分级呼吸闪烁强度（缺省由 active 推导）
}

export function ConstellationField({ constellation, intensity, active, tier }: ConstellationFieldProps) {
  if (intensity <= 0) return null;

  const pointsMap = new Map(constellation.points.map((p) => [p.id, p]));

  // 分级闪烁：中心（tier 0）最强最快，两侧（tier 1）柔和放缓，远端（tier 2）静止只留氛围。
  // 容器整体 opacity=intensity 已天然削弱两侧/远端振幅，无需额外改 keyframe。
  const twinkleTier = tier ?? (active ? 0 : 1);
  const twinkle =
    twinkleTier <= 1 ? `starTwinkle ${twinkleTier === 0 ? 3.2 : 5.4}s ease-in-out infinite` : 'none';

  // Container styling to overlay precisely on top of card background
  const containerStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    pointerEvents: 'none',
    opacity: intensity,
    zIndex: 5,
    overflow: 'visible',
    transition: 'opacity 0.5s ease',
  };

  return (
    <div
      style={containerStyle}
      className={active ? styles.constellationActive : undefined}
    >
      <svg
        viewBox="0 -40 100 140"
        style={{
          width: '100%',
          height: '140%',
          overflow: 'visible',
          position: 'absolute',
          top: '-40%',
        }}
      >
        {/* 1. 绘制连线 (Edges) */}
        <g stroke="var(--gold-glow)" strokeWidth="0.5" opacity="0.6">
          {constellation.edges.map((edge, idx) => {
            const fromPt = pointsMap.get(edge.from);
            const toPt = pointsMap.get(edge.to);
            if (!fromPt || !toPt) return null;

            return (
              <line
                key={`edge-${idx}`}
                x1={fromPt.x}
                y1={fromPt.y}
                x2={toPt.x}
                y2={toPt.y}
              />
            );
          })}
        </g>

        {/* 2. 绘制星点 (Glow Nodes) */}
        <g fill="var(--gold-light)">
          {constellation.points.map((p) => (
            <g
              key={p.id}
              style={{
                transformOrigin: `${p.x}% ${p.y}%`,
                // 分级闪烁（中心强 / 两侧柔 / 远端静），带坐标偏移的 stagger 延迟
                animation: twinkle,
                animationDelay: `${(p.x * 0.03 + p.y * 0.02)}s`,
              }}
            >
              {/* 最外层超大漫反射光晕 */}
              <circle
                cx={p.x}
                cy={p.y}
                r="3.6"
                fill="var(--gold-glow)"
                opacity="0.12"
              />
              {/* 次外层中等光晕 */}
              <circle
                cx={p.x}
                cy={p.y}
                r="1.8"
                fill="var(--gold-light)"
                opacity="0.38"
              />
              {/* 核心高亮星点 */}
              <circle
                cx={p.x}
                cy={p.y}
                r="0.8"
                fill="#ffffff"
              />
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
export default ConstellationField;
