# 夜阑项目 - 偶发输出截断问题的系统级根因分析

**日期**: 2026-08-16  
**问题性质**: 偶发性、近期高频

## 问题时间线

- **7月30日前**: 系统正常运行
- **7月30日**: 提交 `cee16cc` - 添加 `TOKEN_GUARD_ENABLED` 开关
- **7月31日**: 最后一次错误日志记录
- **8月11日**: 开始出现偶发的输出截断/消息重复问题
- **8月15日**: 问题持续发生

## 🎯 系统级根本原因

### 1. Node.js HTTP 服务器默认超时

**关键发现**: `apps/api/src/index.ts:200`

```typescript
serve({ fetch: app.fetch, port: profile.port, hostname: profile.host });
```

**问题**: 没有配置任何超时参数，使用 Node.js HTTP 服务器的默认值：

| 超时类型 | Node.js 默认值 | 影响 |
|---------|---------------|------|
| `headersTimeout` | **60秒** (Node 20+) | SSE 流超过60秒无新数据 → 连接断开 |
| `requestTimeout` | **0 (无限制)** | 单个请求无超时 |
| `keepAliveTimeout` | **5秒** | 空闲连接5秒后关闭 |
| `timeout` | **0 (无限制)** | Socket 无超时 |

**关键矛盾**:
- 角色扮演长对话生成时间可能 > 60秒
- `headersTimeout` 在60秒无新数据时会**静默关闭连接**
- 前端 `openChatStream` 抛出错误 → catch 块捕获
- `assistantBuf` 有部分内容 → `finally` 块保存 → **截断回复被保存**

### 2. Caddy 反向代理的 keepalive 配置

**位置**: `infra/deploy/Caddyfile:39`

```
transport http {
    keepalive 30s
}
```

**问题**: Caddy 到后端的 keepalive 是 30秒，但 Node.js 的 `keepAliveTimeout` 是 5秒

**冲突**: 
- Caddy 认为连接可以保持 30秒
- Node.js 在 5秒空闲后就关闭连接
- 可能导致连接状态不一致

### 3. 前端代码的缺陷放大了问题影响

**位置**: `apps/web/src/hooks/useChat.ts:50, 122-128`

```typescript
// Line 50: 用户消息过早保存
useChatStore.getState().addUserMessage(userMsg);

// Line 122-128: 无条件保存部分内容
} finally {
  if (assistantBuf) {
    useChatStore.getState().addAssistantMessage(assistantBuf);
  }
  useChatStore.getState().incrementRound();  // 无论成功失败
}
```

**放大效应**: 
- 如果只是超时，前端重试即可
- 但由于用户消息已保存 + 部分内容被当作完整回复
- 用户无法判断"是否发送成功"
- 导致重复发送、对话历史混乱

## 为什么是"偶发"问题？

### 触发条件组合

问题只在**同时满足**以下条件时触发：

1. **长对话场景** - 生成时间接近或超过 60秒
2. **流式输出缓慢** - AI 生成速度慢，导致60秒内无足够数据
3. **用户等待** - 用户没有主动点击停止
4. **网络稳定** - 如果网络不稳定早就断了，反而触发其他错误路径

### 为什么8月份开始高频？

可能的原因（推测）：

**原因A: 模型或提示词变化**
- 8月份调整了提示词（system prompt）
- 导致 AI 生成变慢或输出变长
- 更容易触发 60秒超时

**原因B: 用户使用模式变化**
- 长对话场景增多（角色扮演深入）
- 单轮生成内容变长
- 更容易超过 60秒阈值

**原因C: 上游模型服务变化**
- Anthropic/OpenAI/DeepSeek 的响应速度波动
- 某些时段生成速度变慢
- 偶发性触发超时

## 完整的问题链

```
触发条件: 长对话 + 生成慢 + 接近60秒

1. 用户发送消息
2. Line 50: addUserMessage() → 用户消息保存 ✅
3. SSE 流开始，assistantBuf 累积内容
4. 生成时间超过 60秒
5. Node.js headersTimeout 触发 → 静默关闭连接
6. 前端 openChatStream 抛出错误（连接断开）
7. catch 块: 打印错误
8. finally 块: assistantBuf 有内容 → 保存部分回复 ❌
9. finally 块: incrementRound() → 轮次+1

结果:
✅ 用户消息已保存
❌ 部分回复被当作完整回复保存
✅ 轮次递增
→ 用户看到不完整的回复

用户反应:
- 如果认为"生成未完成" → 重新发送相同消息（消息重复）
- 如果认为"AI断片了" → 继续发新消息（多条无回复）
```

## 证据链

### 证据1: 时间吻合
- 60秒超时阈值 vs 观察到的截断时间
- 8月份问题高发 vs 可能的系统/使用变化

### 证据2: 截断特征
```
assistant 09:05:59: 弗朗西斯正懒洋洋地靠在沙发扶手上...蓝丝带
```
- 不是句子自然结束
- 不是 token 限制（太短了）
- 像是**连接突然断开**

### 证据3: 用户行为
```
user 09:14:46: 弗朗西斯…你在吗
user 09:14:55: 弗朗西斯…胃疼
```
- 连续发送，没有回复
- 说明第一条"看起来发了"但实际没收到回复
- 符合"用户消息已保存但 SSE 失败"的场景

### 证据4: 无错误日志
- 最后的 error.log 是 7月31日
- 8月11-15日的问题**没有记录**
- 说明可能不是 5xx 错误，而是**连接超时**
- 超时通常只在前端抛出，不会触发服务端错误日志

## 完整修复方案

### 修复1: 配置 Node.js 服务器超时（立即执行）

**文件**: `apps/api/src/index.ts`

```typescript
import { serve } from '@hono/node-server';

// ... 其他代码

// ── 启动 ─────────────────────────────────────────────────────────────────
const server = serve({ 
  fetch: app.fetch, 
  port: profile.port, 
  hostname: profile.host 
});

// ✅ 配置超时 - SSE 流式响应需要更长的超时时间
if (server instanceof require('http').Server) {
  // headersTimeout: SSE 流可以持续很长时间，禁用或设置很大的值
  server.headersTimeout = 0;  // 0 = 无限制
  
  // requestTimeout: 单个请求的总超时
  server.requestTimeout = 0;  // 0 = 无限制
  
  // keepAliveTimeout: 保持活动连接的超时
  server.keepAliveTimeout = 65000;  // 65秒，比 Caddy 的 30s 大
  
  console.log('[server] Configured timeouts for SSE streams');
}

if (profile.verboseStartup) {
  // ... 其余启动日志
}
```

**为什么这样配置**:
- `headersTimeout = 0`: SSE 流需要持续很长时间，不应该超时
- `requestTimeout = 0`: 长对话生成没有固定时长
- `keepAliveTimeout = 65000`: 比 Caddy 的 30秒大，避免提前关闭

### 修复2: 前端延迟保存用户消息（核心修复）

**文件**: `apps/web/src/hooks/useChat.ts`

参见前面的完整修复代码（message-duplication-root-cause.md）

```typescript
let streamStarted = false;

for await (const ev of openChatStream(req, ctrl.signal)) {
  // ✅ 第一个事件到达才保存用户消息
  if (!streamStarted) {
    useChatStore.getState().addUserMessage(userMsg);
    streamStarted = true;
  }
  // ...
}

// ✅ 区分 AbortError 和连接超时
} catch (e) {
  if (e instanceof Error && e.name === 'AbortError') {
    wasAborted = true;
  } else {
    console.warn('[chat] stream error:', (e as Error).message);
    if (!streamStarted) {
      alert('发送失败，请检查网络后重试');
    }
  }
} finally {
  // ✅ 只保存成功且未中止的回复
  if (assistantBuf && streamStarted && !wasAborted) {
    useChatStore.getState().addAssistantMessage(assistantBuf);
  }
  
  // ✅ 只在成功时增加轮次
  if (streamStarted && !wasAborted) {
    useChatStore.getState().incrementRound();
  }
}
```

### 修复3: 对齐 Caddy keepalive（可选）

**文件**: `infra/deploy/Caddyfile`

```caddyfile
handle /api/* {
    reverse_proxy api:8787 {
        flush_interval -1
        transport http {
            keepalive 70s  # ✅ 改为 70秒，与后端的 65秒对齐
            keepalive_idle_conns 10
        }
    }
}
```

### 修复4: 添加心跳机制（长期优化）

在 SSE 流中定期发送心跳，避免超时：

**文件**: `apps/api/src/routes/chat.ts`

```typescript
// 在流式输出循环中
let lastChunkTime = Date.now();

for await (const result of streamMainLLM(...)) {
  if (result.chunk) {
    assistantBuffer += result.chunk.text;
    await writeEv({ kind: 'chunk', ... });
    lastChunkTime = Date.now();
  }
  
  // ✅ 如果超过30秒没有新内容，发送心跳
  if (Date.now() - lastChunkTime > 30000) {
    await writeEv({ kind: 'heartbeat' });  // 新增心跳事件
    lastChunkTime = Date.now();
  }
}
```

## 立即执行步骤

### 第1步: 应用服务端超时修复（5分钟）

```bash
cd /root/YetLand2026/apps/api/src
nano index.ts

# 在 serve() 调用后添加超时配置
# 参考上面的"修复1"代码
```

### 第2步: 应用前端修复（15分钟）

```bash
cd /root/YetLand2026/apps/web/src/hooks
nano useChat.ts

# 实施延迟保存用户消息 + 区分 AbortError
# 参考 message-duplication-root-cause.md
```

### 第3步: 重启服务

```bash
cd /root/YetLand2026/infra/deploy
docker compose restart
```

### 第4步: 验证修复

测试长对话场景：
1. 发送消息，等待长时间生成（> 60秒）
2. 观察是否还有截断
3. 检查对话历史是否完整

## 监控验证

### 添加超时日志

在超时配置后添加日志：

```typescript
server.on('timeout', (socket) => {
  console.warn('[server] Socket timeout detected', {
    remoteAddress: socket.remoteAddress,
    bytesRead: socket.bytesRead,
    bytesWritten: socket.bytesWritten,
  });
});
```

### 前端监控

在 catch 块中区分错误类型：

```typescript
} catch (e) {
  const errorType = e instanceof Error ? e.name : 'unknown';
  const errorMsg = e instanceof Error ? e.message : String(e);
  
  console.log('[chat] stream error', {
    type: errorType,
    message: errorMsg,
    streamStarted,
    partialLength: assistantBuf.length,
  });
  
  // 可以发送到分析系统
  if (errorType === 'AbortError') {
    // 用户主动取消
  } else if (errorMsg.includes('timeout') || errorMsg.includes('network')) {
    // 网络或超时问题
  }
}
```

## 预期效果

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 生成超过60秒 | ❌ 连接断开，保存截断 | ✅ 正常完成 |
| 网络超时 | ❌ 用户消息已保存 | ✅ 不保存，提示重试 |
| 用户点击停止 | ❌ 保存截断 | ✅ 丢弃不保存 |
| 长对话完整生成 | ⚠️ 可能超时 | ✅ 稳定完成 |

## 相关文件

- **核心服务端修复**: `apps/api/src/index.ts`
- **核心前端修复**: `apps/web/src/hooks/useChat.ts`
- Caddy配置: `infra/deploy/Caddyfile`
- 聊天路由: `apps/api/src/routes/chat.ts`

## 总结

### 系统级根本原因

**Node.js HTTP 服务器的默认 `headersTimeout` 为 60秒**，SSE 流式响应超过60秒无新数据会被静默断开。

### 为什么是偶发？

只有在**长对话 + 生成慢 + 接近60秒阈值**时才触发，不是每次都会发生。

### 为什么8月开始高频？

可能的原因：
- 提示词调整导致生成变慢
- 用户长对话场景增多
- 上游模型服务响应变慢

### 核心修复

1. **服务端**: 禁用或大幅提高 `headersTimeout`
2. **前端**: 延迟保存用户消息 + 区分错误类型

### 实施优先级

🔴 **最高优先级**: 修复1（服务端超时）+ 修复2（前端逻辑）

这是导致近期所有三种异常现象的**根本系统级原因**。
