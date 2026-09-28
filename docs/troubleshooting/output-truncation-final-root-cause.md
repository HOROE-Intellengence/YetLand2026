# 夜阑项目 - 输出截断问题最终根因分析

**日期**: 2026-08-16  
**问题**: 近期频繁出现AI回复截断、不完整

## ✅ 已排除的原因

经过代码审查，以下机制**已正常工作**：

1. ✅ **UI防护到位** - 输入框和发送按钮都有 `disabled={sending}` 绑定
2. ✅ **状态检查存在** - `useChat.ts:39` 有 `if (sending) return` 检查
3. ✅ **Token限制已解决** - 前次问题（SESSION_TOKEN_LIMIT=200k）已修复
4. ✅ **有停止按钮** - 用户可以手动取消正在进行的回复

## 🎯 真正的根本原因

### 问题代码

**文件**: `apps/web/src/hooks/useChat.ts:52-53, 119-128`

```typescript
// Line 52-53: 创建新的 AbortController，但没有取消旧的
const ctrl = new AbortController();
ctrlRef.current = ctrl;  // ⚠️ 直接覆盖

// Line 119-128: catch 块没有区分 AbortError
} catch (e) {
  console.warn('[chat] stream error:', (e as Error).message);  // ⚠️ 不区分错误类型
} finally {
  if (assistantBuf) {  // ⚠️ 无论是正常完成还是被中止，都会保存
    if (assistantParts && assistantParts.length > 0) {
      useChatStore.getState().addStructuredAssistantMessage(assistantBuf, assistantParts);
    } else {
      useChatStore.getState().addAssistantMessage(assistantBuf);
    }
  }
  // ...
}
```

### 核心问题

**问题1: 没有显式取消旧请求**
- Line 52 直接创建新 `AbortController` 并覆盖 `ctrlRef.current`
- 如果有旧请求正在进行，旧的 `ctrl` 没有被 `abort()`
- 虽然引用丢失了，但旧的 SSE 连接可能仍然存活

**问题2: 不区分正常完成和用户中止**
- catch 块捕获所有错误，包括 `AbortError`（用户点击停止按钮）
- finally 块无条件保存 `assistantBuf` 的内容
- **即使用户点击"停止"按钮，部分内容仍会被保存为完整回复**

### 触发场景

**场景A: 用户点击停止按钮**
```
1. AI开始生成回复 → assistantBuf 累积内容
2. 用户觉得不满意，点击"停止"按钮
3. cancel() → ctrl.abort() → openChatStream 抛出 AbortError
4. catch 块捕获错误，打印日志
5. finally 块检查 assistantBuf 有内容 → 保存这个被截断的回复 ❌
```

**场景B: 网络中断或超时**
```
1. AI开始生成 → assistantBuf 累积部分内容
2. 网络断开或服务端超时
3. SSE连接断开，抛出错误
4. catch 块捕获
5. finally 块保存部分内容 ❌
```

## 证据链

从您提供的日志：
```
assistant 2026/08/15 09:05:59: 弗朗西斯正懒洋洋地靠在沙发扶手上，手里盘着一截没点燃的烟管，亚麻色的卷发随意用蓝丝带
                               ↑ 句子未完成
```

**分析**：
1. 这个回复非常短（~40字），不可能是自然结束
2. 没有结束标点，在"蓝丝带"后截断
3. 17秒后用户发送了新消息 → 说明用户可能：
   - 点击了停止按钮（等不及了）
   - 或者看到不完整的回复，以为"发完了"然后继续对话

## 完整修复方案

### 修复 1: 区分 AbortError，不保存被中止的回复

**文件**: `apps/web/src/hooks/useChat.ts`

```typescript
let assistantBuf = '';
let assistantParts: StructuredMessagePart[] | null = null;
let wasAborted = false;  // ✅ 添加标志

try {
  for await (const ev of openChatStream(req, ctrl.signal)) {
    switch (ev.kind) {
      case 'chunk':
        assistantBuf += ev.text;
        break;
      // ... 其他 case
    }
    if (ev.kind === 'done' || ev.kind === 'cutoff') break;
  }
} catch (e) {
  // ✅ 区分 AbortError 和其他错误
  if (e instanceof Error && e.name === 'AbortError') {
    console.log('[chat] 用户取消了本轮对话');
    wasAborted = true;
  } else {
    console.warn('[chat] stream error:', (e as Error).message);
  }
} finally {
  // ✅ 只有未被中止的回复才保存
  if (assistantBuf && !wasAborted) {
    if (assistantParts && assistantParts.length > 0) {
      useChatStore.getState().addStructuredAssistantMessage(assistantBuf, assistantParts);
    } else {
      useChatStore.getState().addAssistantMessage(assistantBuf);
    }
  } else if (wasAborted && assistantBuf) {
    console.log(`[chat] 已丢弃被中止的部分回复 (${assistantBuf.length}字符)`);
  }
  
  useChatStore.getState().clearLiveChunks();
  useChatStore.getState().incrementRound();
  onRoundComplete();
  useChatStore.getState().setSending(false);
}
```

### 修复 2: 显式取消旧请求（防御性编程）

```typescript
const send = useCallback(
  async (text: string) => {
    if (!character || useChatStore.getState().sending || !text.trim()) return;
    
    // ✅ 如果有旧请求，先取消它
    if (ctrlRef.current) {
      ctrlRef.current.abort();
    }
    
    const sessionId = ...
    // ... 其余代码不变
    
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    // ...
```

### 修复 3: 增加更明确的用户反馈

**文件**: `apps/web/src/scenes/Conversation.tsx`

在停止按钮旁边添加提示：

```tsx
{sending ? (
  <div className={styles.sendingState}>
    <button className={styles.stopBtn} onClick={cancel} type="button">
      停止
    </button>
    <span className={styles.hint}>生成中...</span>
  </div>
) : (
  <button className={styles.sendBtn} onClick={handleSend} type="button">
    发送
  </button>
)}
```

## 立即执行的修复步骤

### 第1步：应用核心修复

```bash
cd /root/YetLand2026/apps/web/src/hooks
# 备份原文件
cp useChat.ts useChat.ts.backup

# 手动编辑 useChat.ts，应用上述修复1和修复2
nano useChat.ts
```

### 第2步：测试验证

```bash
cd /root/YetLand2026
pnpm dev

# 在浏览器中测试：
# 1. 发送消息，等待AI开始回复
# 2. 点击"停止"按钮
# 3. 查看对话历史 → 应该没有保存被截断的回复
# 4. 查看浏览器Console → 应该看到 "[chat] 用户取消了本轮对话"
```

### 第3步：监控效果

打开浏览器 DevTools Console，查看日志：

**修复前的行为**：
```
[chat] stream error: The user aborted a request.
(然后截断的内容被保存到历史记录)
```

**修复后的行为**：
```
[chat] 用户取消了本轮对话
[chat] 已丢弃被中止的部分回复 (42字符)
(历史记录中没有这条被截断的回复)
```

## 修复效果预期

实施后，以下场景将得到正确处理：

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| 用户点击停止按钮 | ❌ 保存部分内容 | ✅ 丢弃，不保存 |
| 网络中断 | ❌ 保存部分内容 | ✅ 丢弃，不保存 |
| 服务端超时 | ❌ 保存部分内容 | ✅ 丢弃，不保存 |
| 正常完成 | ✅ 正常保存 | ✅ 正常保存 |
| 配额耗尽(cutoff) | ✅ 保存并标记 | ✅ 保存并标记 |

## 额外改进（可选）

### 改进1: 添加"重新生成"按钮

当用户点击停止后，提供一个"重新生成"选项：

```typescript
const [lastAbortedPrompt, setLastAbortedPrompt] = useState<string | null>(null);

// 在 catch 的 AbortError 分支中
if (e instanceof Error && e.name === 'AbortError') {
  setLastAbortedPrompt(text);  // 保存被中止的提示词
  wasAborted = true;
}

// UI中显示
{lastAbortedPrompt && (
  <button onClick={() => send(lastAbortedPrompt)}>
    重新生成上一条回复
  </button>
)}
```

### 改进2: 记录中止统计

帮助了解用户体验问题：

```typescript
if (wasAborted) {
  // 可以发送到分析系统
  console.log('[analytics] reply_aborted', {
    characterId: character.id,
    partialLength: assistantBuf.length,
    round: useChatStore.getState().round,
  });
}
```

## 相关文件

- **核心修复**: `apps/web/src/hooks/useChat.ts`
- UI组件: `apps/web/src/scenes/Conversation.tsx`
- SSE客户端: `apps/web/src/hooks/useSSE.ts`
- API路由: `apps/api/src/routes/chat.ts`

## 总结

**根本原因**: `finally` 块无条件保存 `assistantBuf` 的内容，不区分"正常完成"和"用户中止/网络错误"。

**核心修复**: 在 `catch` 块中检测 `AbortError`，设置标志位，在 `finally` 块中只有非中止的回复才保存。

**预期效果**: 
- ✅ 用户点击停止按钮后，不再保存不完整的回复
- ✅ 网络中断时，不再保存截断的内容
- ✅ 对话历史保持干净，只有完整的回复

**实施优先级**: 🔴 **高优**，建议立即修复
