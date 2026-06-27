# Prompt Playground（占位）

> 修订 #20「人力飞轮」的工程化形态 — 见开发文档 §三.5、§七

## 目标

- 选一个真实历史对话（来自 `conversation_logs`）
- 改 prompt（修改 `packages/prompts/` 下的 yaml/md）
- 重放，对比新旧两版输出（同 LLM provider、同 model、同 seed）
- 评分入库，一周累计 50 次评分驱动 prompt 更新

## 接口（计划）

```bash
pnpm playground replay --session=sess_xxx --prompt-version=v3.3-exp
pnpm playground compare --baseline=v3.2 --candidate=v3.3-exp --n=50
pnpm playground score   --session=sess_xxx --score=4 --note="climax 句子节奏更稳"
```

## TODO

- 写 CLI 入口（commander / 自建）
- LLM 调用复用 `apps/server/src/llm/router.ts`（要把 router 拆成 server 无关的 lib）
- 评分写到独立 `prompt_evaluations` 表
