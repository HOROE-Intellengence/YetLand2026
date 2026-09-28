# 夜阑项目 - 输出截断与消息重复的完整根因分析

**日期**: 2026-08-16  
**问题**: 近期频繁出现的三种异常现象

## 📋 问题现象

### 现象1: AI回复被截断
```
assistant 09:05:59: 弗朗西斯正懒洋洋地靠在沙发扶手上，手里盘着一截没点燃的烟管，亚麻色的卷发随意用蓝丝带
                     ↑ 句子未完成，仅40字符
```

### 现象2: 用户消息未得到回复
```
user 09:14:46: 弗朗西斯…你在吗
user 09:14:55: 弗朗西斯…胃疼
assistant: (无回复)
```

### 现象3: 用户消息重复出现
```
user 23:29:56: （我看了他一眼）你没拒绝，也算是邀请了...
user 23:30:38: （我看了他一眼）你没拒绝，也算是邀请了...  ← 完全相同的内容
assistant 23:30:45: [正常回复]
```

## 🎯 根本原因

### 问题代码分析

**文件**: `apps/web/src/hooks/useChat.ts`

```typescript
// Line 45-50: 用户消息在请求发送前就保存了
useChatStore.getState().setSending(true);
useChatStore.getState().clearLiveChunks();

const userMsg: ChatMessage = { role: 'user', content: text };
const history = useChatStore.getState().messages;
useChatStore.getState().addUserMessage(userMsg);  // ⚠️ 过早保存

// Line 52-79: 构建请求并发送
const ctrl = new AbortController();
ctrlRef.current = ctrl;
const remembered = await recall(...);  // ⚠️ 可能失败
const req: ChatRequest = { ... };

try {
  for await (const ev of openChatStream(req, ctrl.signal)) {  // ⚠️ 可能失败
    // 累积 assistantBuf
  }
} catch (e) {
  console.warn('[chat] stream error:', (e as Error).message);
} finally {
  if (assistantBuf) {  // ⚠️ 如果为空，不保存 assistant 回复
    useChatStore.getState().addAssistantMessage(assistantBuf);
  }
  useChatStore.getState().incrementRound();  // ⚠️ 无论成功失败都增加轮次
  useChatStore.getState().setSending(false);
}
```

### 核心缺陷

**缺陷1: 用户消息过早保存**
- `addUserMessage` 在第50行就执行了
- 此时网络请求还没发送，可能在后续步骤失败
- 如果失败，用户消息已保存但没有对应的 assistant 回复

**缺陷2: 无条件保存截断内容**
- `finally` 块检查 `if (assistantBuf)` 就保存
- 不区分"正常完成"、"用户中止"、"网络错误"
- 导致不完整的回复被当作完整回复保存

**缺陷3: 无论成功失败都增加轮次**
- `incrementRound()` 在 `finally` 块中无条件执行
- 即使请求失败，轮次也会+1
- 导致状态不一致

**缺陷4: 错误处理不当**
- `catch` 块只打印日志，不做任何补救
- 不区分 `AbortError`（用户主动取消）和其他错误
- 不回滚已保存的用户消息

## 🔍 问题触发场景

### 场景A: 网络请求失败（解释现象2）

```
执行流程：
1. 用户输入 "弗朗西斯…你在吗"，点击发送
2. Line 50: addUserMessage() → 用户消息保存到历史 ✅
3. Line 55: await recall() → 可能因网络问题失败
4. 或 Line 79: openChatStream() → 连接失败/超时
5. catch 块: 打印错误日志
6. finally 块: assistantBuf = '' → 不保存 assistant 回复
7. finally 块: incrementRound() → 轮次+1
8. finally 块: setSending(false) → 可以发送新消息

结果：
✅ 用户消息已保存
❌ assistant 回复缺失
✅ 轮次已递增
→ 对话历史出现"孤立的用户消息"
```

**用户体验**：
- 用户看到自己的消息发送成功了
- 但没有得到回复，以为AI没反应
- 用户再发一条类似的消息（"弗朗西斯…胃疼"）
- 导致连续多条用户消息无回复

### 场景B: 用户点击停止按钮（解释现象1）

```
执行流程：
1. 用户发送消息
2. Line 50: addUserMessage() → 用户消息保存 ✅
3. Line 79-82: openChatStream() 开始流式输出
4. assistantBuf 累积了部分内容："弗朗西斯正懒洋洋地靠在沙发扶手上...蓝丝带"
5. 用户点击"停止"按钮 → cancel() → ctrl.abort()
6. openChatStream 抛出 AbortError
7. catch 块: 打印 "stream error: The user aborted a request"
8. finally 块: assistantBuf 有内容 → 保存这个不完整的回复 ❌
9. finally 块: incrementRound() → 轮次+1

结果：
✅ 用户消息已保存
❌ 不完整的 assistant 回复被保存
✅ 轮次已递增
→ 对话历史出现"截断的回复"
```

### 场景C: 用户重复提交（解释现象3）

**根本原因**: 前一次请求失败但用户消息已保存，用户**看不到**回复，误以为"没发出去"，于是重新输入相同内容再发一次。

```
时间线：
T1: 用户输入"（我看了他一眼）你没拒绝..."，点击发送
    → 用户消息保存
    → 网络请求失败或超时
    → 没有 assistant 回复
    → 用户看到：只有自己的消息，没有回复

T2: 用户误以为没发出去，重新输入相同内容
    → 再次点击发送
    → 用户消息再次保存（重复）
    → 这次请求成功
    → assistant 回复保存

结果：
历史记录中出现两条完全相同的用户消息
```

## 完整修复方案

### 修复1: 延迟保存用户消息（核心修复）

**原则**: 只有在请求成功发送后才保存用户消息

```typescript
const send = useCallback(
  async (text: string) => {
    if (!character || useChatStore.getState().sending || !text.trim()) return;
    
    const sessionId = useChatStore.getState().sessionId ?? createLocalSessionId(character.id);
    if (!useChatStore.getState().sessionId) {
      useChatStore.getState().resetForLocalSession(sessionId, character.openingLines.firstVisit);
    }
    
    useChatStore.getState().setSending(true);
    useChatStore.getState().clearLiveChunks();

    // ⚠️ 先不要保存用户消息，只创建对象
    const userMsg: ChatMessage = { role: 'user', content: text };
    const history = useChatStore.getState().messages;
    
    // 显式abort旧请求
    if (ctrlRef.current) {
      ctrlRef.current.abort();
    }
    
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;

    let assistantBuf = '';
    let assistantParts: StructuredMessagePart[] | null = null;
    let wasAborted = false;
    let streamStarted = false;  // ✅ 标记流是否成功开始

    try {
      const remembered = await recall({
        characterId: character.id,
        mode: 'main',
        query: text,
        topK: 5,
      });

      const req: ChatRequest = {
        characterId: character.id,
        sessionId,
        round: useChatStore.getState().round,
        prevStage: useChatStore.getState().stage,
        userBoundary: useChatStore.getState().boundary,
        text,
        history,
        recall: {
          preferences: remembered.preferences.map((p) => p.text),
          events: remembered.events.map((e) => ({ date: e.date, text: e.text, emotion: e.emotion })),
        },
      };

      for await (const ev of openChatStream(req, ctrl.signal)) {
        // ✅ 第一个事件到达时，说明请求成功，现在保存用户消息
        if (!streamStarted) {
          useChatStore.getState().addUserMessage(userMsg);
          streamStarted = true;
        }
        
        switch (ev.kind) {
          case 'chunk':
            assistantBuf += ev.text;
            break;
          case 'meta':
            useChatStore.getState().setStage(ev.stage);
            useChatStore.getState().setBoundary(ev.boundary);
            if (ev.ifActive != null) useChatStore.getState().setIfActive(ev.ifActive);
            useSessionStore.getState().setStage(ev.stage);
            useSessionStore.getState().setBoundary(ev.boundary);
            break;
          case 'atmosphere':
            useChatStore.getState().setTemperature(ev.temperature);
            useSessionStore.getState().setTemperature(ev.temperature);
            break;
          case 'structured':
            assistantBuf = ev.rawText;
            assistantParts = ev.parts;
            if (import.meta.env.DEV) {
              if (ev.source === 'fallback') {
                console.warn(`[分句] 走了正则 fallback，未用真实分句 AI。降级原因=${ev.degradeReason ?? 'unknown'}`);
              } else if (ev.source === 'sidecar') {
                console.info('[分句] 真实分句 AI 生效，已分型');
              }
            }
            break;
          case 'achievement':
            useSessionStore.getState().pushAchievement({ slug: ev.slug });
            break;
          case 'cutoff':
            useSessionStore.getState().cutoff();
            break;
          case 'error':
            throw new Error(`${ev.code}: ${ev.message}`);
          case 'done':
            break;
        }
        if (ev.kind === 'done' || ev.kind === 'cutoff') break;
      }
    } catch (e) {
      // ✅ 区分不同类型的错误
      if (e instanceof Error && e.name === 'AbortError') {
        console.log('[chat] 用户取消了本轮对话');
        wasAborted = true;
      } else {
        console.warn('[chat] stream error:', (e as Error).message);
        
        // ✅ 如果请求彻底失败且用户消息未保存，通知用户
        if (!streamStarted) {
          console.error('[chat] 请求失败，消息未发送');
          // 可以在这里显示一个Toast通知用户
        }
      }
    } finally {
      // ✅ 只有成功开始且未被中止才保存 assistant 回复
      if (assistantBuf && streamStarted && !wasAborted) {
        if (assistantParts && assistantParts.length > 0) {
          useChatStore.getState().addStructuredAssistantMessage(assistantBuf, assistantParts);
        } else {
          useChatStore.getState().addAssistantMessage(assistantBuf);
        }
      } else if (wasAborted && assistantBuf) {
        console.log(`[chat] 已丢弃被中止的部分回复 (${assistantBuf.length}字符)`);
      }
      
      useChatStore.getState().clearLiveChunks();
      
      // ✅ 只有成功完成才增加轮次
      if (streamStarted && !wasAborted) {
        useChatStore.getState().incrementRound();
        onRoundComplete();
      }
      
      useChatStore.getState().setSending(false);
    }
  },
  [character],
);
```

### 修复2: 添加请求失败提示

**文件**: `apps/web/src/hooks/useChat.ts` + UI组件

在 catch 块中，如果请求彻底失败，显示用户友好的错误提示：

```typescript
} catch (e) {
  if (e instanceof Error && e.name === 'AbortError') {
    console.log('[chat] 用户取消了本轮对话');
    wasAborted = true;
  } else {
    console.warn('[chat] stream error:', (e as Error).message);
    
    if (!streamStarted) {
      // ✅ 显示错误提示
      alert('发送失败，请检查网络连接后重试');  // 或使用Toast组件
    }
  }
}
```

### 修复3: 输入框保留失败的内容

如果发送失败，恢复输入框内容，避免用户重新输入：

```typescript
const send = useCallback(
  async (text: string) => {
    // ... 前面代码相同
    
    // 在函数开始时保存输入框引用
    const inputElement = inputRef.current;
    
    try {
      // ... 原有逻辑
    } catch (e) {
      // ... 错误处理
      
      // ✅ 如果失败且流未开始，恢复输入框内容
      if (!streamStarted && inputElement) {
        inputElement.value = text;
      }
    } finally {
      // ... 原有逻辑
    }
  },
  [character],
);
```

## 修复效果对比

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 网络请求失败 | ❌ 用户消息已保存，无回复 | ✅ 用户消息不保存，可重试 |
| 用户点击停止 | ❌ 保存截断的回复 | ✅ 丢弃，不保存 |
| recall失败 | ❌ 用户消息已保存 | ✅ 用户消息不保存 |
| 正常完成 | ✅ 正常保存 | ✅ 正常保存 |
| 连接超时 | ❌ 用户消息已保存 | ✅ 提示用户重试 |

## 测试验证清单

修复后需要测试的场景：

### ✅ 正常流程
- [ ] 发送消息 → 收到完整回复 → 历史正常

### ❌ 异常流程
- [ ] 断网发送 → 提示失败 → 输入框恢复 → 历史不保存用户消息
- [ ] 点击停止 → 不保存截断回复 → 可以重新发送
- [ ] 服务端超时 → 提示失败 → 可以重试
- [ ] 快速连续点击发送 → 只发送一次（disabled防护）

## 监控指标

修复后可以监控以下指标验证效果：

```typescript
// 统计各类错误
const errorStats = {
  aborted: 0,        // 用户主动取消
  networkFailed: 0,  // 网络失败
  streamStarted: 0,  // 成功开始流
  completed: 0,      // 正常完成
};

// 在对应位置埋点
if (e.name === 'AbortError') errorStats.aborted++;
else if (!streamStarted) errorStats.networkFailed++;
if (streamStarted && !wasAborted) errorStats.completed++;
```

## 相关文件

- **核心修复**: `apps/web/src/hooks/useChat.ts`
- UI组件: `apps/web/src/scenes/Conversation.tsx`
- SSE客户端: `apps/web/src/hooks/useSSE.ts`
- 服务端路由: `apps/api/src/routes/chat.ts`

## 总结

### 根本原因

**过早保存用户消息** + **无条件保存截断回复** + **错误处理不当**

三个缺陷叠加，导致：
1. ❌ 用户消息未得到回复（请求失败但消息已保存）
2. ❌ AI回复被截断（用户中止但部分内容仍保存）
3. ❌ 用户消息重复（失败后用户以为没发出去，重新发送）

### 核心修复

**延迟保存用户消息**：只有在第一个SSE事件到达时（`streamStarted=true`）才保存用户消息

### 预期效果

- ✅ 请求失败时，用户消息不会孤立地出现在历史中
- ✅ 用户点击停止时，截断的回复不会被保存
- ✅ 失败后有明确提示，避免用户重复发送
- ✅ 对话历史保持完整性：每条用户消息都有对应的assistant回复

**实施优先级**: 🔴 **最高优**，这是导致用户体验严重下降的核心bug
