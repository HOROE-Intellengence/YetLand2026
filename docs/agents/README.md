# 3-Skill AI 团队协作约定

夜阑项目使用 3 层 AI 团队协作。每个角色有专属 skill 入场简报，确保跨会话
跨工具的纪律统一。

## 团队结构

```
真人 PM（用户）
   ↓
Claude（Anthropic main）— PM / 架构师，做判断与决策
   ├─ skill: solo-rotation-pm.md
   ↓
DeepSeek Claude Code — 开发部，按 spec 实施（C1 模式下可作母实例 spawn sub-agents）
   ├─ skill: 协作deepseek-Claudecode提示.md
   ↓
Codex（OpenAI CLI）— 验证机，跑命令出事实（独立进程，双盲验证证据源）
   └─ skill: 协作CodeX提示.md
```

## 文件清单

| 文件 | 给谁 | 触发方式 |
|---|---|---|
| [`solo-rotation-pm.md`](solo-rotation-pm.md) | Claude main（PM/架构师） | 手动粘到新窗口第一条消息 |
| [`协作deepseek-Claudecode提示.md`](协作deepseek-Claudecode提示.md) | DeepSeek-powered Claude Code（开发部） | 手动粘到新窗口第一条消息 |
| [`协作CodeX提示.md`](协作CodeX提示.md) | Codex（验证机） | 手动粘到 Codex 第一条消息 |

也可以把 `solo-rotation-pm.md` / `协作deepseek-Claudecode提示.md` 存到 `~/.claude/skills/<name>/SKILL.md`
让 Claude Code 自动加载（如果你的客户端支持）；项目内 `docs/agents/` 是 canonical source of truth。

## 协作流程

```
1. PM (Claude main) → 给过程
   产出：spec / handoff / ADR / 入场指令 / sub-agent 入场指令模板

2. DeepSeek → 执行 + 报告（C1 模式下母实例调度 sub-agents 并行）
   产出：commit + 完成报告（含"验证命令"表）

3. Codex → 详细审计（独立进程，可与 DeepSeek 双盲并行）
   产出：声称 vs 实测对照表（纯事实，不判性质）

4. PM → 判性质 + 仲裁矛盾 + 合 main
   产出：处置（接受 / 返修 / 阻塞）+ git merge
```

## 关键共享约定（3 个 skill 共同引用）

- **状态采集 3 件套**：`git status` / `git branch --show-current` / `git log --oneline -5`
- **Commit message 规范**：`<type>(<scope>): <desc> (<工单 ID>)`
- **Blocker 文件路径**：`docs/sprint/<sprint>-blocker-<topic>.md`
- **门禁命令**：`pnpm verify:gray`
- **保留 stub 不动**：`apps/server/src/routes/{auth,pay/*,db/*,llm/providers/*}.ts`
- **历史名不改**：`mock-fallback`（ADR-0007）/ `docs/sprint/2026-05-14-*`（历史 report）
- **Framing 原则**：prompt / 入场指令不用能力贬低 framing（"智商较低 / 不如 X"），改行为侧描述（LLM 对自我标签敏感，会自我催眠）

## 版本

- **v1**（2026-05-14）：3-skill 三件套初版
- **v1.1**（2026-05-14）：基于 BE-139 实战修订
  - Codex skill 加 `node_modules` 排除 + Template F preflight
  - DeepSeek skill §5.3 加 BE-139 故障案例
  - PM skill §9 加 "Codex ✗ 必须 follow-up，不走捷径"
- **v1.2**（2026-05-15）：激进委派协议升级
  - **C1 模式**：DeepSeek 母实例（C1 mode）内部 spawn sub-agents 加速执行 + Codex 独立进程验证（保证进程隔离）
  - **双盲验证机制**：Codex + DeepSeek 并行跑同一份验收清单（不知对方在跑），PM 仲裁矛盾。从单点抓粉饰升级到仲裁矛盾
  - **Framing 修复**：删除三份 skill 里所有能力贬低 framing，改用行为侧描述（LLM 自我催眠风险）
  - **节俭原则升级**：Read 任意文件默认派 Codex 摘要（< 50 行关键决策文件例外）；brainstorm 候选派 Codex 出，PM 裁
  - **母 spec 结构**：sub-agent 入场指令模板由 PM 出（不让母 DeepSeek 自己设计 → 标准漂移）
  - **文件改名**（surface 收敛）：`deepseek-dev.md` → `协作deepseek-Claudecode提示.md`，`codex-verifier.md` → `协作CodeX提示.md`
  - 散件 `feedback_delegation_aggressive.md` 合并进三份 skill 后删除

## 实战记录索引

| 日期 | 工单 | 验证了什么 | 经验落档 |
|---|---|---|---|
| 2026-05-14 | BE-139 | 3-skill 协议首次实战 | v1.1 修订 |
| 2026-05-15 | — | 协议升级（用户反馈：激进委派 + framing 修复 + C1 双盲） | v1.2 修订 |
