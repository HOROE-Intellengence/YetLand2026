# ADR-0001: 采用 pnpm monorepo 三段式（apps / packages / infra）

- **状态**: Accepted
- **日期**: 2026-05-07
- **决策者**: 工程团队

## 背景

夜阑 Phase 1 同时存在：主前端 SPA、主后端 Workers、独立的 NVIDIA 限制解除 Worker、本地 mock 服务器、未来的长图分享子站、运营后台前端、共享类型与 prompt 资产。

如果各项目分仓，类型会复制三份、prompt 改一句要联动几个 PR、设计 token 在前端和长图站之间漂移。

## 选项

- A. **多仓**：每个 app 独立仓库，靠 npm 私有 registry 共享类型。
- B. **monorepo + pnpm workspace**：一个仓库，apps/packages 切分。
- C. **monorepo + Turborepo / Nx**：B + 任务编排工具。

## 决策

选 **B**。

理由：
- 当前团队 3-4 人，A 的协调成本不划算。
- C 的 Turborepo 在 Workers/Vite 配合上还会引入额外抽象；先 pnpm workspace，达到瓶颈再加 Turborepo 也不迟（无破坏性升级）。
- pnpm workspace 内的 `workspace:*` 协议天然适合 `@yelan/shared`、`@yelan/prompts`、`@yelan/design-tokens` 的本地链接。

## 后果

- 所有跨包改动一次 PR 即可。
- CI 需要按 `--filter` 增量构建（`infra/ci/`）。
- 所有 app 必须遵循同一 `tsconfig.base.json`，不允许各自魔改严格度。
