// 设计 token 单一真理源 — apps/web、apps/share、长图导出全部消费此文件
// 任何颜色 / 字号 / 阴影改动都必须先改这里
export const color = {
  bg: '#0a0a0f',
  bg2: '#0d0d14',
  paper: '#c8b8a4',
  paperDim: '#8a7e6e',
  paperMute: '#5a5248',
  gold: '#a08060',
  goldLight: '#c8a878',
  goldGlow: 'rgba(200, 168, 120, 0.45)',
  ink: 'rgba(200, 184, 164, 0.05)',
} as const;

export const font = {
  serif: "'Noto Serif SC', Georgia, serif",
  ui: "'Inter', system-ui, sans-serif",
} as const;

export const typeScale = 1.3;
export const sizes = {
  xxs: 11, xs: 12, sm: 13, md: 15, lg: 17, xl: 20, '2xl': 24, '3xl': 32,
} as const;

// 响应式断点（px）— web 专属，纯常量，不影响 share / 长图导出。
// md(768) 为「手机/平板」主分界（对齐选角页既有断点）；lg(980) 对齐落地页断点。
// 新代码统一用这三档，逐步收敛 640/420 等散点。
export const breakpoints = { sm: 480, md: 768, lg: 980 } as const; // px

// stage 映射 — 见开发文档 §四.2
export const stageLayout = {
  daily:  { gutter: 80, fontPx: 15, lineHeight: 1.9 },
  rise:   { gutter: 60, fontPx: 15, lineHeight: 1.8 },
  climax: { gutter: 40, fontPx: 16, lineHeight: 1.7 },
  after:  { gutter: 80, fontPx: 15, lineHeight: 2.0 },
  end:    { gutter: 80, fontPx: 15, lineHeight: 2.0 },
} as const;

export const proseWidth = 560;
export const paragraphGap = 24;

// 关键句额外停顿（修订 #25）
export const keySentencePauseMs = 700;
