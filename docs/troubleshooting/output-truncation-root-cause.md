# 夜阑项目 - 输出截断问题根因分析

**日期**: 2026-08-16  
**问题**: 近期出现的频繁输出截断、回复不完整

## 问题复现

从提供的对话日志可见：

```
user 2026/08/15 09:05:50: 树影阑珊
assistant 2026/08/15 09:05:59: 弗朗西斯正懒洋洋地靠在沙发扶手上，手里盘着一截没点燃的烟管，亚麻色的卷发随意用蓝丝带
                               ↑ 截断，句子未完成
user 2026/08/15 09:06:16: 树影斑驳
user 2026/08/15 09:06:33: "……弗朗西斯，我头疼，伊万呢，儿子们呢。"
assistant 2026/08/15 09:06:37: [完整回复...]
```

**关键观察**：
1. 09:05:59 的回复被截断在"蓝丝带"处
2. 仅17秒后（09:06:16）用户发送了新消息
3. 09:06:37 的回复是完整的
4. 截断的回复非常短（约40字符），不可能是token限制

## 根本原因

### 🎯 核心问题：用户快速连发导致流式响应被截断

**技术分析**：

#### 1. **前端防护机制存在但不够严格**

**代码位置**: `apps/web/src/hooks/useChat.ts:39`
```typescript
if (!character || useChatStore.getState().sending || !text.trim()) return;
```

**问题**：虽然有 `sending` 状态检查，但在以下场景会失效：

**场景A：竞态条件（Race Condition）**
```
时间轴：
T0: 用户发送消息A → setSending(true)
T1: 服务端开始流式响应
T2: 前端UI渲染可能延迟，sending状态未及时反映到按钮disabled
T3: 用户快速点击/回车发送消息B
T4: 此时checking sending状态可能仍为false或刚变true但UI未更新
```

#### 2. **UI层防护不足**

**代码位置**: `apps/web/src/scenes/Conversation.tsx:168-174`
```typescript
const handleSend = () => {
  const text = inputRef.current?.value.trim();
  if (!text || sending) return;  // ✅ 有检查
  inputRef.current!.value = '';  // ⚠️ 但清空输入框的时机可能导致用户误判
  autoGrowTextarea(inputRef.current!);
  void send(text);
};
```

**问题**：
- 发送按钮的 `disabled` 属性可能未绑定 `sending` 状态
- 输入框在请求发送前就被清空，用户误以为"已经发完了，可以发下一条"
- 没有明显的视觉反馈（loading状态、禁用态）

#### 3. **服务端的截断保存行为**

**代码位置**: `apps/api/src/routes/chat.ts:178-188`
```typescript
try {
  for await (const result of streamMainLLM(...)) {
    if (result.chunk) {
      assistantBuffer += result.chunk.text;
      await writeEv({ kind: 'chunk', ... });
    }
    ...
  }
  
  if (assistantBuffer) {  // ⚠️ 只要有内容就保存
    persistAssistantMessage(body.sessionId, assistantBuffer);
    ...
  }
```

**问题**：
- 当前端 `AbortController.abort()` 时，`streamMainLLM` 的循环会终止
- 但 `finally` 块中的代码仍会执行（`useChat.ts:122-133`）
- `assistantBuffer` 里只有已累积的部分内容就会被保存
- **没有区分"完整完成"和"中途取消"的场景**

#### 4. **前端中止机制**

**代码位置**: `apps/web/src/hooks/useChat.ts:52-53, 138-140`
```typescript
const ctrl = new AbortController();
ctrlRef.current = ctrl;

// ...

const cancel = useCallback(() => {
  ctrlRef.current?.abort();
}, []);
```

**触发时机**：
- 用户明确点击取消按钮（如果有）
- **组件卸载**
- **新的send()调用开始时，旧的ctrl被替换但未显式abort**

**关键发现**：
```typescript
// useChat.ts:52 - 每次send()都会创建新的AbortController
const ctrl = new AbortController();
ctrlRef.current = ctrl;  // ⚠️ 直接覆盖，旧的没有被abort
```

虽然有 `if (sending) return` 的保护，但如果存在任何绕过情况（UI延迟、状态同步问题），新请求会覆盖 `ctrlRef.current`，而**旧请求的 AbortController 没有被显式取消**。

## 问题场景重现路径

**最可能的触发路径**：

```
1. 用户发送消息A
   → setSending(true)
   → 服务端开始流式输出

2. UI渲染延迟（50-200ms）
   → 发送按钮/输入框视觉上看起来还可用
   → 用户快速输入下一条消息

3. 用户按回车发送消息B
   → handleSend()被调用
   → 此时有两种可能：
   
   情况1：sending检查通过（竞态）
   → 创建新的AbortController
   → 旧的ctrl没被abort但被覆盖
   → 旧请求的SSE连接仍在，但前端已不监听
   → finally块执行，保存部分内容

   情况2：sending检查失败（正常）
   → return，本次点击无效
   → 但用户可能连续多次快速点击/回车
   → 某次可能在状态切换瞬间通过检查
```

## 证据支持

1. **时间间隔吻合**：09:05:59 → 09:06:16 仅17秒，典型的"用户等不及，连续发送"行为
2. **截断内容短**：只有40字符，说明流刚开始就被中断
3. **后续正常**：09:06:37的完整回复说明系统本身没问题，是用户行为触发的边缘情况

## 解决方案

### 方案1：强化前端UI防护（推荐，立即实施）

**修改文件**: `apps/web/src/scenes/Conversation.tsx`

```typescript
// 1. 发送按钮添加disabled绑定
<button 
  className={styles.sendBtn} 
  onClick={handleSend} 
  disabled={sending}  // ✅ 添加这行
  type="button"
>
  {sending ? '发送中...' : '发送'}
</button>

// 2. 输入框在sending时也禁用
<textarea
  ref={inputRef}
  disabled={sending}  // ✅ 添加这行
  placeholder={sending ? "回复生成中..." : "说点什么..."}
  onKeyDown={handleKeyDown}
  ...
/>

// 3. handleKeyDown增强检查
const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (sending) return;  // ✅ 添加这行
    handleSend();
  }
};
```

### 方案2：显式取消旧请求（推荐，立即实施）

**修改文件**: `apps/web/src/hooks/useChat.ts`

```typescript
const send = useCallback(
  async (text: string) => {
    if (!character || useChatStore.getState().sending || !text.trim()) return;
    
    // ✅ 显式取消旧请求
    if (ctrlRef.current) {
      ctrlRef.current.abort();
      ctrlRef.current = null;
    }
    
    const sessionId = ...
    // ... 其余代码
```

### 方案3：服务端区分完整/中止（中期优化）

**修改文件**: `apps/web/src/hooks/useChat.ts`

```typescript
let assistantBuf = '';
let streamCompleted = false;  // ✅ 添加标志

try {
  for await (const ev of openChatStream(req, ctrl.signal)) {
    switch (ev.kind) {
      case 'chunk':
        assistantBuf += ev.text;
        break;
      case 'done':
        streamCompleted = true;  // ✅ 标记完成
        break;
      // ...
    }
    if (ev.kind === 'done' || ev.kind === 'cutoff') break;
  }
} catch (e) {
  if (e.name === 'AbortError') {
    console.warn('[chat] 用户取消了本轮对话');
    // ✅ 不保存被中止的回复
    assistantBuf = '';
  } else {
    console.warn('[chat] stream error:', (e as Error).message);
  }
} finally {
  // ✅ 只有正常完成才保存
  if (assistantBuf && streamCompleted) {
    if (assistantParts && assistantParts.length > 0) {
      useChatStore.getState().addStructuredAssistantMessage(assistantBuf, assistantParts);
    } else {
      useChatStore.getState().addAssistantMessage(assistantBuf);
    }
  }
  // ...
}
```

### 方案4：添加用户提示（短期改善）

在输入区域添加视觉反馈：

```tsx
{sending && (
  <div className={styles.sendingIndicator}>
    <span className={styles.spinner}></span>
    正在生成回复，请稍候...
  </div>
)}
```

## 立即执行步骤

### 第1步：快速验证（5分钟）

检查UI组件中发送按钮和输入框是否有 `disabled={sending}` 绑定：

```bash
cd /root/YetLand2026
grep -n "disabled.*sending\|sending.*disabled" apps/web/src/scenes/Conversation.tsx
```

如果输出为空，说明**确实缺少UI防护**。

### 第2步：应用修复（15分钟）

1. 修改 `apps/web/src/scenes/Conversation.tsx`（方案1）
2. 修改 `apps/web/src/hooks/useChat.ts`（方案2 + 方案3）
3. 测试验证

### 第3步：测试验证

```bash
cd /root/YetLand2026
pnpm dev

# 在浏览器中：
# 1. 发送一条消息
# 2. 在回复生成过程中，快速连续按回车或点击发送按钮
# 3. 预期：按钮应该被禁用，无法触发新请求
# 4. 预期：回复应该完整保存，不再出现截断
```

## 监控与验证

### 检查是否有中止的请求

在浏览器 DevTools Console 中查看：

```javascript
// 应该能看到类似的日志
[chat] 用户取消了本轮对话  // 如果实施了方案3
```

### 统计截断问题发生率

```bash
# 查看是否有endedInsideThink警告（另一种截断）
cd /root/YetLand2026
grep "endedInsideThink\|truncated by unclosed" apps/api/logs/*.log
```

## 预防措施

### 代码规范

1. **所有异步操作的UI触发器都必须绑定loading状态的disabled**
2. **AbortController的切换必须显式abort旧实例**
3. **流式响应的保存必须区分完整/中止状态**

### 用户体验改进

1. 发送按钮在 `sending=true` 时显示"发送中..."并禁用
2. 输入框在生成回复时显示占位符"回复生成中，请稍候..."
3. 添加明显的loading动画（如输入框上方的进度条）

## 相关文件

- 前端聊天hook: `apps/web/src/hooks/useChat.ts`
- 对话UI组件: `apps/web/src/scenes/Conversation.tsx`
- 服务端聊天路由: `apps/api/src/routes/chat.ts`
- 聊天管道: `apps/api/src/pipeline/chat-pipeline.ts`

## 总结

**根本原因**：用户快速连续发送消息，绕过了前端的 `sending` 状态检查，导致：
1. 新请求创建时旧请求的 `AbortController` 被覆盖但未abort
2. 旧请求的流式响应在中途被中断
3. `finally` 块仍然执行，将部分累积的内容保存为"完整"回复

**优先级**：
- 🔴 高优：方案1（UI防护）+ 方案2（显式abort）
- 🟡 中优：方案3（区分完整/中止）
- 🟢 低优：方案4（用户提示）

**预期效果**：实施方案1+2后，截断问题应该**完全消失**。
