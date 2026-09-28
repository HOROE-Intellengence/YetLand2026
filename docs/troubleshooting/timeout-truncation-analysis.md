# 夜阑项目 - 超时与截断机制全面分析

**日期**: 2026-08-18  
**目的**: 系统性检查所有可能导致会话截断的超时点和机制  
**状态**: 仅检查，不执行修复

---

## 一、超时点分析（按请求链路）

### 1.1 前端层

#### ❌ **没有显式超时**
**文件**: `apps/web/src/api/sse.ts`

```typescript
const res = await fetch(env.apiBase + '/api/chat', {
  method: 'POST',
  headers: { /* ... */ },
  body: JSON.stringify(body),
  signal,  // 只有 AbortController，无超时机制
});
```

**问题**:
- 前端 fetch 没有设置任何超时
- 完全依赖用户手动点击"停止"按钮或浏览器默认超时
- 浏览器默认超时通常是 **300秒（5分钟）** 或更长

**影响**:
- 如果后端卡住不响应，前端会永久等待
- 用户看到"发送中"状态无限期挂起

---

### 1.2 Caddy 反向代理层

#### ✅ **配置正确**
**文件**: `infra/deploy/Caddyfile`

```
handle /api/* {
  reverse_proxy api:8787 {
    flush_interval -1      # 实时下发，不缓冲
    transport http {
      keepalive 30s        # keepalive 30秒
    }
  }
}
```

**特点**:
- `flush_interval -1`: 禁用缓冲，SSE chunk 实时转发 ✅
- `keepalive 30s`: TCP 连接保活 30 秒 ✅
- **没有显式的 read_timeout 或 write_timeout** ✅

**验证**:
Caddy 默认没有响应超时限制，适合 SSE 长连接。

---

### 1.3 Node.js HTTP 服务器层

#### ✅ **已修复（8月16日）**
**文件**: `apps/api/src/index.ts`

```typescript
server.headersTimeout = 0;      // 无限制 ✅
server.requestTimeout = 0;      // 无限制 ✅
server.keepAliveTimeout = 65000; // 65秒 ✅
```

**历史问题**:
- Node.js 20+ 默认 `headersTimeout = 60000` (60秒)
- SSE 流在 60 秒时会被静默断开

**当前状态**: 已解决 ✅

---

### 1.4 SSE 路由层（chat.ts）

#### ⚠️ **没有显式超时，但有间接限制**
**文件**: `apps/api/src/routes/chat.ts`

**关键点**:
```typescript
// Line 178: 主 LLM 流式输出
for await (const result of streamMainLLM(useReal, stage, system, recentHistory, body.text, reasoningEffort)) {
  if (result.chunk) {
    assistantBuffer += result.chunk.text;
    await writeEv({ kind: 'chunk', text: result.chunk.text, ... });
  }
  // ...
}
```

**问题**:
1. **没有总时长限制** - 如果 LLM 一直不返回首个 token，会永久等待
2. **没有心跳机制** - 长时间无输出时，中间层（CDN/NAT）可能断开连接
3. **catch 块捕获所有错误** (Line 221-225)，但没有区分超时类型

---

### 1.5 LLM Provider 层

#### ❌ **关键缺陷：max_tokens 默认值过低 + 没有处理 finish_reason**

**文件**: `packages/llm/src/providers/openai.ts`

```typescript
// Line 50
max_tokens: req.maxTokens ?? 1024,  // ⚠️ 默认只有 1024 tokens
```

**问题 1: max_tokens 过低**
- **默认值**: 1024 tokens
- **实际消耗**: 中文约 500-700 字
- **角色扮演场景**: 长叙事回复常超过 1024 tokens

**问题 2: 没有处理 finish_reason**
```typescript
// Line 96-100: 只取 content，完全忽略 finish_reason
const ev = JSON.parse(payload) as {
  choices?: Array<{ delta?: { content?: string } }>;
  // ❌ 没有读取 finish_reason
};
```

**OpenAI SSE 响应格式**:
```json
{
  "choices": [{
    "delta": { "content": "文本" },
    "finish_reason": "length"  // ⚠️ 被截断时是 "length"，不是 "stop"
  }]
}
```

**后果**:
- 模型因 max_tokens 截断时，前端无法知道
- 用户看到句子在中间断开，以为是 bug
- 后端也没有警告日志

---

### 1.6 侧袋 AI 超时

#### ✅ **已配置超时**
**文件**: `apps/api/src/sidecar-ai/client.ts`

```typescript
const SIDECAR_DEFAULT_TIMEOUT_MS = 5000;  // 5秒

const timeoutMs = opts.timeoutMs ?? SIDECAR_DEFAULT_TIMEOUT_MS;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
```

**配置点**:
- `output-structurer.ts`: `OUTPUT_STRUCTURER_TIMEOUT_MS = 8000` (可通过 env 覆盖)
- `atmosphere-judge.ts`: 默认 5000ms

**影响**:
- 侧袋超时会**降级到 fallback**，不会中断主流
- 不会导致会话截断 ✅

---

## 二、截断机制分析

### 2.1 Token 限制（已关闭）

#### ✅ **已配置为关闭**
**文件**: `infra/deploy/docker-compose.yml` + `.env`

```yaml
TOKEN_GUARD_ENABLED: ${TOKEN_GUARD_ENABLED:-off}  # 默认关闭
```

**验证**:
```bash
# 当前配置
TOKEN_GUARD_ENABLED=off
SESSION_TOKEN_LIMIT=500000
```

**状态**: 不会导致截断 ✅

---

### 2.2 Think 标签截断

#### ⚠️ **可能的截断源**
**文件**: `packages/llm/src/think-sanitizer.ts`

**机制**:
```typescript
// 如果模型输出了 <think>...</think>，sanitizer 会隔离内部内容
// 但如果流在 <think> 内部被截断（没有 </think>），会导致：
export interface SanitizerStats {
  enteredThink: boolean;
  endedInsideThink: boolean;  // ⚠️ 这个标志表示截断
}
```

**处理**:
```typescript
// apps/api/src/pipeline/chat-pipeline.ts:473
if (sanitizerStats?.endedInsideThink) {
  console.warn('[chat] reply truncated by unclosed think tag');
  // ⚠️ 只是警告，没有向用户提示
}
```

**问题**:
1. 如果模型在 think 内部被 max_tokens 截断
2. Sanitizer 会隔离所有 <think> 之后的内容
3. 用户看到的回复可能是空的或截断的
4. 没有明确的错误提示

---

### 2.3 max_tokens 截断（核心问题）

#### ❌ **最可能的截断原因**

**证据链**:

1. **默认值过低**: 1024 tokens ≈ 500-700 中文字
2. **没有检测 finish_reason**: 无法区分"自然结束"和"超限截断"
3. **没有用户提示**: 截断时用户不知道发生了什么

**触发场景**:
```
用户: "详细描述一下今天的场景"
模型: 开始生成长叙事
     ↓ 生成 500 字
     ↓ 生成 700 字
     ↓ 达到 1024 tokens → 被截断
     ↓ finish_reason: "length" (但前端没读取)
用户: 看到句子断在"她靠在沙发扶手上，手里盘着一截没点燃的烟管，亚麻色的卷发随意用蓝丝带"
     ↑ 正好在 1024 tokens 处截断
```

**验证方法**:
查看日志中的 `[cost] turn cost`，如果 outputTokens 接近 1024，则是此问题。

---

### 2.4 上下文压缩

#### ✅ **不会导致当前回复截断**
**文件**: `apps/api/src/sidecar-ai/context-compressor.ts`

**机制**:
- 压缩的是**旧对话历史**（超过 15 轮的部分）
- 不影响当前正在生成的回复

**状态**: 不会导致截断 ✅

---

## 三、问题优先级排序

### 🔴 高优先级（极可能是根因）

#### 1. **max_tokens 默认值过低 + 没有处理 finish_reason**

**影响范围**: ⭐⭐⭐⭐⭐ 所有长回复  
**修复难度**: ⭐⭐ 简单

**建议修复**:
```typescript
// packages/llm/src/providers/openai.ts
max_tokens: req.maxTokens ?? 4096,  // 从 1024 提升到 4096

// 同时读取 finish_reason
const ev = JSON.parse(payload) as {
  choices?: Array<{ 
    delta?: { content?: string };
    finish_reason?: string | null;
  }>;
};

if (ev.choices?.[0]?.finish_reason === 'length') {
  // 发送警告事件或在末尾追加提示
}
```

---

### 🟡 中优先级

#### 2. **缺少心跳机制**

**影响范围**: ⭐⭐⭐ 长时间"思考"的场景  
**修复难度**: ⭐⭐⭐ 中等

**问题**:
如果模型在首个 token 返回前耗时过长（如 o1 推理模型），中间层可能超时断开。

**建议修复**:
```typescript
// 在 streamSSE 中定期发送心跳注释
const heartbeat = setInterval(() => {
  stream.writeSSE({ comment: 'keepalive' });
}, 15000);  // 每 15 秒一次
```

---

#### 3. **Think 标签截断没有用户提示**

**影响范围**: ⭐⭐ 使用推理模型时  
**修复难度**: ⭐ 简单

**建议修复**:
```typescript
if (sanitizerStats?.endedInsideThink) {
  await writeEv({ 
    kind: 'error', 
    code: 'THINK_TRUNCATED', 
    message: '推理内容被截断，请重试' 
  });
}
```

---

### 🟢 低优先级

#### 4. **前端没有超时保护**

**影响范围**: ⭐ 罕见（后端挂起）  
**修复难度**: ⭐⭐ 简单

**建议修复**:
```typescript
// apps/web/src/api/sse.ts
const timeoutController = new AbortController();
const timeout = setTimeout(() => {
  timeoutController.abort();
}, 120000);  // 2 分钟超时
```

---

## 四、检查清单总结

| 层级 | 组件 | 超时配置 | 状态 | 备注 |
|------|------|----------|------|------|
| 前端 | fetch | ❌ 无 | ⚠️ 依赖浏览器默认 | 可能 5 分钟+ |
| 反向代理 | Caddy | ✅ 无限制 | ✅ 正常 | flush_interval -1 |
| HTTP服务器 | Node.js | ✅ 0 (无限制) | ✅ 已修复 | 8月16日 |
| SSE路由 | chat.ts | ❌ 无 | ⚠️ 无总时长限制 | 无心跳 |
| LLM | Provider | ⚠️ max_tokens=1024 | ❌ **过低** | **核心问题** |
| 侧袋AI | sidecar-ai | ✅ 5-8秒 | ✅ 正常 | 降级不中断 |
| Token限制 | token-guard | ✅ off | ✅ 已关闭 | 不影响 |

---

## 五、推荐的修复顺序（不执行）

### 第一步：修复 max_tokens（最重要）

**文件**: `packages/llm/src/providers/openai.ts`, `anthropic.ts`, `nvidia-unlim.ts`

1. 将默认 `max_tokens` 从 1024 提升到 4096 或 8192
2. 读取并处理 `finish_reason`
3. 当 `finish_reason === 'length'` 时：
   - 在日志中记录警告
   - 可选：向前端发送 `kind: 'warning'` 事件

---

### 第二步：添加心跳机制

**文件**: `apps/api/src/routes/chat.ts`

在 `streamSSE` 内部启动定时器，每 15-30 秒发送一次注释：
```typescript
stream.writeSSE({ comment: 'keepalive' });
```

---

### 第三步：改进 Think 截断提示

**文件**: `apps/api/src/pipeline/chat-pipeline.ts`

当检测到 `endedInsideThink` 时，发送明确的错误事件。

---

### 第四步：添加前端超时保护

**文件**: `apps/web/src/api/sse.ts`

为 fetch 添加总超时限制（如 2-5 分钟）。

---

## 六、日志检查命令

### 检查是否因 max_tokens 截断

```bash
# 查看最近的 token 消耗
docker compose logs api --tail 100 | grep "\[cost\]"

# 如果 outputTokens 频繁接近 1024，则证实是此问题
# 示例输出:
# [cost] turn cost: provider=ai model=gemini-3.5-flash-lite tokens=1520 cost=$0.00152
#                                                                   ↑ 接近 1024 的值
```

### 检查 think 标签截断

```bash
docker compose logs api --tail 200 | grep "truncated by unclosed think"
```

### 检查 SSE 连接断开

```bash
docker compose logs api --tail 200 | grep "stream error"
```

---

## 七、结论

**最可能的截断原因**: `max_tokens=1024` 过低

**证据**:
1. 用户报告的截断位置常在句子中间
2. 角色扮演长叙事场景容易触发
3. 没有读取 `finish_reason`，无法诊断

**次要问题**:
1. 缺少心跳机制（长时间无输出）
2. Think 标签截断提示不明确
3. 前端无超时保护

**已解决**:
1. ✅ Node.js 60秒超时
2. ✅ Token 硬限制已关闭
3. ✅ 前端错误处理已区分 AbortError

---

**报告人**: Claude (Kiro AI)  
**生成时间**: 2026-08-18 17:15  
**下一步**: 等待用户确认后执行修复
