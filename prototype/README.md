# prototype/ —— 原始 UI 基线

这是产品负责人确认的**目标 UI**（动画、文案、抽屉、调息节奏均已调好），保留为开发期间的视觉真理源。

## 怎么跑

直接用浏览器打开 `夜阑.html` 即可，无需任何构建。它使用：

- React 18 UMD
- ReactDOM 18 UMD
- Babel standalone（在浏览器里编译 JSX）

> 性能很差但用于演示足够。**不要往这里加新功能**，新功能写到 `apps/web/`。

## 文件映射

| prototype | apps/web 对应位置 |
|---|---|
| `app.jsx` | `apps/web/src/App.tsx` |
| `intro.jsx` | `apps/web/src/scenes/IntroScene.tsx` + `OpeningScene.tsx` + `CharacterSelect.tsx` |
| `scenes.jsx` | `apps/web/src/scenes/Conversation.tsx` + `NarrativeCutoff.tsx` |
| `dialogue.jsx` | `apps/web/src/components/conversation/*` |
| `drawer.jsx` | `apps/web/src/components/drawer/*` |
| `particles.jsx` | `apps/web/src/components/particles/ParticleField.tsx` |
| `tweaks-panel.jsx` | `apps/web/src/components/tweaks/TweaksPanel.tsx` |

## 何时归档？

`apps/web/` 完成全量迁移并通过设计走查后，把本目录整体移到 `docs/prototype-snapshot/`。在那之前不能删。
