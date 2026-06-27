# @yelan/design-tokens

设计 token 单一真理源。

- `src/tokens.ts` — TS 导出（apps/web 等代码消费）
- `src/tokens.css` — CSS variables（CSS Modules 消费）

两份当前是手工对齐。后续加 `scripts/sync-tokens.mjs` 让 `.css` 从 `.ts` 派生。
