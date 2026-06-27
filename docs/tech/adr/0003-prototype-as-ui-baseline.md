# ADR-0003: prototype/ 作为目标 UI 基线，apps/web 增量迁移

- **状态**: Accepted
- **日期**: 2026-05-07
- **决策者**: 工程团队

## 背景

`prototype/` 下的 React UMD + Babel standalone JSX 已经是产品负责人确认的目标 UI（动画、文学性文案、抽屉、调息节奏均已调好）。直接改 prototype 不可持续：没类型、没构建、没模块边界。

## 决策

- `prototype/` 原封不动保留，可直接 `open prototype/夜阑.html` 在本地浏览。
- 新建 `apps/web/`（Vite + React 18 + TS + CSS Modules），文件结构按 prototype 的拆分（intro / scenes / dialogue / drawer / particles / tweaks-panel）镜像建立，每个组件 stub 顶部写明 `// 来源: prototype/<file>.jsx`，便于一对一搬迁。
- 搬迁原则："文学性文案、动画时长、CSS keyframes" 一字不改；"硬编码状态、CDN 引入、内联事件" 重构为 hooks / stores。
- 当 `apps/web/` 全量覆盖 prototype 后，`prototype/` 移到 `docs/prototype-snapshot/` 归档（不删）。

## 后果

- 设计/PM 在 prototype 上做的微调，迁移期内必须双写到 apps/web；这是有意识的代价，靠每周 sync 控制 drift。
- prototype 里的 `EDITMODE-BEGIN/END` 标记保留为 TweaksPanel 的 contract，apps/web 同名组件需要兼容这个序列化形态。
