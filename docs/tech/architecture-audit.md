# 夜阑 架构审计报告

> **日期**：2026-05-10
> **版本**：v0.73.510.16
> **范围**：全仓库代码结构、质量、完成度
> **结论**：骨架是钛合金的，肉还没长。架构设计优秀，产品完成度约 15%。

> **复审补记（2026-05-10）**：SSE 客户端 Zod 校验、6 类 SSE 事件消费、shared contract 对齐、记忆/偏好 API 收敛、policy 面板与关键模块测试已补。当前真正阻塞推进的是：Web 主体验仍是空壳、缺 lint/format 基线、核心对话流缺集成测试、`useChat` 消息状态设计风险、Admin 默认 token fallback。

> **风险补记（2026-05-11）**：新增 `apps/server` 本地联动 fallback（ADR-0007）。它让 `apps/server:8789` 能代理到 `apps/mock-server:8787` 跑完整链路，但这是测试桥，不是 Workers 真实业务实现完成。测试部需按 `TODOlist.md TEST-105` 专项覆盖。

> **重构勘误（2026-05-20）**：2026-05 重构后 §2.2 列出的 stub 文件状态已变：
> - LLM providers (`anthropic/openai/deepseek/nvidia-unlim`) 已抽到 `packages/llm` 并实现真实流式
> - `services/logs.ts`、`services/surveys.ts`、`pipeline/cost-tracker.ts`、`pipeline/memo-extractor.ts` 已接 D1 真实现
> - **但 `middleware/auth.ts`、`services/auth.ts`、`services/billing.ts` 从空 stub 改写成了"看起来像实现"的 dev-mode 占位**（任意 OTP 通过、明文 token、额度永远放行）。三个文件顶部已加 `⚠️ DEV-MODE ONLY` 横幅。
>
> 见 [REFACTOR_ACCEPTANCE_REPORT.md](../../REFACTOR_ACCEPTANCE_REPORT.md) §3 勘误段。

---

## 1. 总览

| 维度 | 评分 | 说明 |
|---|---|---|
| TypeScript 严格性 | **A** | `strict: true` + `noUncheckedIndexedAccess`，零 `any`、零 `@ts-ignore` |
| Monorepo 结构 | **A** | pnpm workspace 干净，`workspace:*` 协议正确，无循环依赖 |
| 共享类型/Schema | **A** | Zod schema 集中在 `@yelan/shared`，单一真相源 |
| 文档质量 | **A+** | 7 份 ADR、数据归属表、中文开发文档——这个阶段的项目里极其少见 |
| 原型隔离 | **A** | prototype 代码没有污染生产代码 |
| 代码结构 | **B** | 包边界清晰，pipeline 层有重复但结构合理 |
| CSS/设计系统 | **B-** | token 理论正确，但手动镜像存在漂移风险 |
| 安全模型 | **C+** | 部署模式检查、preflight 校验到位，但 admin 默认 token 和 PII 日志是隐患 |
| 代码重复 | **C** | Boundary 类型 ×3、Pipeline 逻辑 ×2、CSS tokens ×2 |
| 前端完成度 | **D-** | 25 个组件中 20 个 `return null`，原型未移植 |
| 测试覆盖 | **D** | shared schema + mock-server pipeline/policy/memories 已有基础覆盖；前端、SSE 集成、端到端仍缺 |
| Lint/Format | **F** | 零 ESLint 配置，零 Prettier 配置，lint 脚本跑不了 |
| apps/server（Workers 路线） | **暂缓 + 本地联动桥** | 真实业务实现仍属 DEFER-002；`pnpm dev:server` 可通过 mock fallback 跑入口链路，但不得作为生产完成度 |

---

## 2. 致命问题（P0）

### 2.1 前端是空壳

`apps/web` 的 25 个组件中约 20 个直接 `return null`：

| 文件 | 行数 | 状态 |
|---|---|---|
| `scenes/Conversation.tsx` | 17 | `return null` + `void` 压制未使用变量 |
| `scenes/OpeningScene.tsx` | 11 | `return null` |
| `scenes/CharacterSelect.tsx` | 17 | `return null` + `void pickCharacter; void data;` |
| `scenes/NarrativeCutoff.tsx` | 11 | `return null` |
| `scenes/IntroScene.tsx` | 17 | 空的 `<div>`，TODO: "移植 SVG 题字" |
| `components/drawer/DrawerRail.tsx` | 8 | `return null` |
| `components/drawer/panels/*Panel.tsx` ×8 | 4-5 | 全部 `return null` |
| `components/achievement/AchievementFlash.tsx` | 11 | `return null` |
| `components/conversation/ExitFadeLayer.tsx` | 3 | `return null` |
| `components/conversation/TypingDots.tsx` | 3 | `return null` |
| `components/tweaks/*.tsx` ×4 | 2-22 | `void` 压制 + `return null` |

原型 `prototype/` 中有完整实现（scenes.jsx 688 行、drawer.jsx 41165 行），但**一个都没移植**。

### 2.2 apps/server 原生实现仍是空壳，但新增本地联动桥

`apps/server` 有 56 个 TODO，关键路径全部是 stub：

| 文件 | 问题 |
|---|---|
| `db/client.ts` | `query()` 直接 throw `'TODO: connect Postgres'` |
| `db/repositories.ts` | 12 个方法中 10 个是 `/* TODO */` |
| `middleware/auth.ts` | `c.set('userId', 'TODO')` —— 认证用户 ID 是字面量 |
| `llm/providers/anthropic.ts` | `stream()` 返回 `{ text: 'TODO' }` |
| `llm/providers/deepseek.ts` | 整个文件 `/* TODO */` |
| `llm/providers/openai.ts` | 整个文件 `/* TODO */` |
| `llm/providers/nvidia-unlim.ts` | 整个文件 `/* TODO */` |
| `routes/auth.ts` | 返回 `{ token: 'TODO', me: null }` |
| `routes/billing.ts` | 返回空数组 `c.json([])` |
| `services/auth.ts` | `sendOtp` / `verifyOtp` 都是 TODO |

编译通过，但原生实现仍不能处理完整真实业务请求。2026-05-11 新增 `mock-fallback` 后，`pnpm dev:server` 可以从 `apps/server:8789` 入口代理到 `apps/mock-server:8787` 跑通 `/admin`、`/api/admin/*`、`/api/chat` 等链路。

审计口径：这只是本地/测试桥，不是生产完成度。任何报告都必须区分：

- `pnpm dev:server:raw`：Workers stub 原生能力
- `pnpm dev:server`：Workers 入口 + mock-server fallback

### 2.3 前端 / SSE 集成测试仍缺

全项目当前 mock-server 侧已有 9 个测试文件 / 35 cases（含侧袋 AI 状态与 health 回归），但联动 fallback 没有自动化覆盖：

| 测试文件 | 位置 |
|---|---|
| `boundary.test.ts` | mock-server/pipeline |
| `sentence-segmenter.test.ts` | mock-server/pipeline |
| `stage-engine.test.ts` | mock-server/pipeline（5 个用例） |
| `yaml.test.ts` | mock-server/prompts |
| `policy.test.ts` | mock-server/routes/admin |
| `memories.test.ts` | mock-server/services |
| `policy.test.ts` | mock-server/services |
| `sidecar-ai/state.test.ts` | mock-server/sidecar-ai |
| `health.test.ts` | mock-server/routes/admin |

复审口径：`pnpm --filter "./apps/mock-server" run test` 当前 9 文件 / 35 case 通过。但**零覆盖区域**仍包括前端组件、前端 hooks、SSE 对话流、认证中间件、持久化层、端到端流程，以及新加的 `apps/server → mock-server` fallback。下一步应补核心对话流集成测试和 TEST-105，而不是继续堆纯函数测试。

### 2.4 无 Lint/Format 配置

- 全项目 **零** `.eslintrc*` 或 `eslint.config.*`
- 全项目 **零** `.prettierrc*`
- `apps/web/package.json` 写了 `"lint": "eslint src --ext .ts,.tsx"` 但 eslint 没安装
- 没有 CI 强制执行，代码风格完全靠自觉

---

## 3. 中等问题（P1）

### 3.1 Boundary 类型重复定义 3 次

```typescript
// packages/shared/src/enums/boundary.ts
export type Boundary = 1 | 2 | 3 | 4 | 5;

// apps/mock-server/src/pipeline/boundary.ts
export type Boundary = 1 | 2 | 3 | 4 | 5;

// apps/server/src/pipeline/boundary.ts
export type Boundary = 1 | 2 | 3 | 4 | 5;
```

改一处忘另两处就出 bug。应统一从 `@yelan/shared` 导入。

### 3.2 Pipeline 逻辑 mock/server 双份

`stage-engine`、`boundary`、`sentence-segmenter` 在两个后端各有一份实现，靠注释 `// 协议对齐 apps/mock-server/...` 维持同步，无自动化保障。server 端的实现是 stub：

```typescript
// apps/server/src/pipeline/stage-engine.ts
export function judgeStage(_input: StageInput): Stage {
  // TODO(Phase 1 W5+): 迁移 mock-server 的关键词词典
  return 'daily';
}
```

### 3.3 CSS Tokens 手动镜像

| 文件 | 说明 |
|---|---|
| `packages/design-tokens/src/tokens.ts` | TypeScript 源（真相源） |
| `packages/design-tokens/src/tokens.css` | 标注"自动生成"但实际手写 |
| `apps/web/src/styles/tokens.css` | 手动从 tokens.ts 抄写，含 TODO："用脚本自动生成" |

两份 CSS tokens 已不同步（web 版多出 font-size 和 layout token）。应构建脚本从 TS 源自动生成 CSS。

### 3.4 useChat 依赖数组循环

```typescript
// apps/web/src/hooks/useChat.ts
const send = useCb(async (text: string) => {
  const history = messages;  // ← 引用 messages
  setMessages((prev) => [...prev, userMsg]); // ← 修改 messages
}, [character, sessionId, messages, sending, stage, boundary]);
//                  ^^^^^^^^  ← messages 在依赖数组中
```

`send` 依赖 `messages`，`send` 自己改 `messages`，组件上线后会导致无限重渲染。目前因 Conversation 是 stub 未触发，但接上线就会炸。

### 3.5 Admin 硬编码默认 Token

```typescript
// apps/admin/src/api/client.ts:12
const token = localStorage.getItem(LS_TOKEN) || 'admin-dev-token';
```

部署到非 localhost 环境，任何浏览器都能以 admin 身份访问。

### 3.6 SSE 客户端不做 Schema 校验（已修复）

```typescript
// apps/web/src/api/sse.ts:53
yield JSON.parse(payload) as ChatStreamEvent;
```

`ChatStreamEventSchema` 存在于 `@yelan/shared`，但前端只做了 `JSON.parse + as` 类型断言，没有运行时校验。畸形数据可直入。

复审结果：`apps/web/src/api/sse.ts` 已改为 `ChatStreamEventSchema.safeParse()`；畸形 JSON / 协议漂移会转成 `error` 事件。`useChat` 已消费 `achievement` / `cutoff` / `error`，但还缺集成测试覆盖。

### 3.7 记忆系统向量检索是空壳

`embedder.worker.ts` 全部注释掉，`recall()` 使用子串匹配：

```typescript
// apps/web/src/memory/keyword-fallback.ts
function scoreText(query: string, text: string): number {
  const target = text.toLowerCase();
  if (target.includes(query)) return 10;
  const tokens = Array.from(new Set(query.split(/\s+/).filter(Boolean)));
  return tokens.reduce((sum, token) => sum + (target.includes(token) ? 1 : 0), 0);
}
```

线性扫描 + 子串匹配，记忆量大了召回质量必崩。

### 3.8 未使用依赖

`framer-motion` 在 `apps/web` 的 `devDependencies` 中声明，但全项目零 import，白加 60KB+ 包体积。

---

## 4. 轻度问题（P2）

| 问题 | 位置 | 说明 |
|---|---|---|
| PII 日志 | `mock-server/routes/auth.ts:18` | `console.log` 打印手机号到 stdout |
| 空 catch 块 | `web/memory/sync.ts:207`、`stores/preferencesStore.ts:33` | 静默吞掉服务端错误，数据丢失风险 |
| 内联样式 | `GlowSentence.tsx`、`NarrationText.tsx`、`ParticleField.tsx` | 应使用 token 引用的 CSS class |
| 模块级副作用 | `mock-server/store/persistence.ts:275-286` | import 时注册 process 退出钩子，单元测试隔离困难 |
| Unsafe 类型断言 | `mock-server/services/characters.ts:37-40` | `as string[]` 绕过运行时校验，畸形 YAML 导致远端报错 |
| eslint-disable | `admin/routes/*.tsx` | `eslint-disable-line react-hooks/exhaustive-deps` 用作 band-aid |
| apps/share 和 apps/unlim-worker | 缺少 package.json | `pnpm dev:unlim` 会失败 |

---

## 5. 架构优点记录

审计中也发现了一些值得保持的优秀实践：

1. **ADR 体系**：5 份架构决策记录，格式规范（Context/Decision/Consequences），含关键决策反转记录（ADR-0005 从"记忆零服务端"反转为"服务器是数据真理源"）
2. **数据归属表**（`docs/architecture/data-locality.md`）：为每个数据实体定义了真相源、本地副本位置、同步策略、删除路径——比大多数生产项目都好
3. **Zod Schema 单一真相源**：`packages/shared` 统一管理请求/响应校验，前端后端共享
4. **原型隔离**：prototype 的全局变量污染（`window.DIALOGUE_OPENING`）没有渗透到生产代码
5. **TypeScript 纪律**：零 `any`、零 `@ts-ignore`、严格模式全开——团队 TS 水平很高
6. **依赖版本一致性**：TypeScript、Hono、Zod、React 版本在各包间一致

---

## 6. 优先修复建议

| 优先级 | 行动 | 理由 |
|---|---|---|
| **P0-1** | 添加 ESLint + Prettier 配置 | 不加这个，代码量一上去就是屎山的起点 |
| **P0-2** | 移植 prototype 到 apps/web | 产品根本跑不起来，所有场景都是空壳 |
| **P0-3** | 核心对话流写集成测试 | 这是产品命脉，零测试太危险 |
| **P0-4** | 移除 Admin 默认 token fallback | 非本地访问前必须处理，否则默认开后门 |
| **P1-1** | 统一 Boundary 类型 | 从 `@yelan/shared` 导入，删除本地重声明 |
| **P1-2** | 修复 useChat 依赖数组 | 将 messages 放入 Zustand store 或用 useRef |
| **P1-3** | SSE 客户端加 Schema 校验 | ✅ 已修复：`ChatStreamEventSchema.safeParse()` 代替 `as` 断言 |
| **P1-4** | CSS tokens 自动生成脚本 | 消除手动镜像漂移 |
| **P1-5** | Pipeline 逻辑提取到 shared 包 | 消除 mock/server 双份维护 |
| **P1-6** | Admin 移除硬编码 token fallback | 改为无 token 时跳转到登录页 |
| **P2-1** | 移除未使用的 framer-motion | 减少包体积 |
| **P2-2** | 记忆系统接通向量检索 | keyword-fallback 不可扩展 |
| **P2-3** | 修复空 catch 块 | 至少加 `console.warn` |

---

*本报告基于 2026-05-10 代码快照，随项目演进需定期复审。*
