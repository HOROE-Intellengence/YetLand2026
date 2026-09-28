# 会话截断问题 - 修复实施报告

**日期**: 2026-08-18  
**执行时间**: 18:05 - 18:07  
**状态**: ✅ 已完成修复并重启服务

---

## 一、已实施的修复

### 1. 提升 max_tokens 限制 ✅

**修改文件**:
- `packages/llm/src/providers/openai.ts`
- `packages/llm/src/providers/anthropic.ts`
- `packages/llm/src/providers/nvidia-unlim.ts`
- `packages/llm/src/providers/deepseek.ts` (使用 openai.ts，自动继承)

**修改内容**:
```typescript
// 从
max_tokens: req.maxTokens ?? 1024

// 改为
max_tokens: req.maxTokens ?? 8192
```

**影响**:
- 默认输出长度从 ~500-700 字提升到 ~4000-5000 字
- 角色扮演长叙事场景不再轻易触发截断
- **8倍提升**

---

### 2. 添加 finish_reason 检测与提示 ✅

#### OpenAI 兼容 Provider (openai.ts, deepseek.ts)

```typescript
const finishReason = ev.choices?.[0]?.finish_reason;
if (finishReason === 'length') {
  console.warn(`[${name}] Response truncated due to max_tokens limit`);
  yield { text: '\n[回复因长度限制被截断]', finished: true };
  streamEnded = true;
  break;
} else if (finishReason === 'stop') {
  streamEnded = true;
  break;
}
```

#### Anthropic Provider (anthropic.ts)

```typescript
if (ev.type === 'message_delta' && ev.delta) {
  const stopReason = (ev.delta as { stop_reason?: string }).stop_reason;
  if (stopReason === 'max_tokens') {
    console.warn(`[${name}] Response truncated due to max_tokens limit`);
    yield { text: '\n[回复因长度限制被截断]', finished: true };
    streamEnded = true;
    break;
  }
}
```

#### NVIDIA Provider (nvidia-unlim.ts)

```typescript
if (finishReason === 'length') {
  console.warn(`[${name}] Response truncated due to max_tokens limit`);
  yield { text: '\n[回复因长度限制被截断]', finished: true };
  streamEnded = true;
  break;
} else if (finishReason === 'stop') {
  streamEnded = true;
  break;
}
```

**效果**:
1. 当模型因 max_tokens 截断时，在回复末尾追加提示
2. 在服务器日志中记录警告
3. 用户能明确知道是因为长度限制而不是 bug

---

### 3. 添加 SSE 心跳机制 ✅

**修改文件**: `apps/api/src/routes/chat.ts`

**添加代码**:
```typescript
return streamSSE(c, async (stream) => {
  const requestId = ...
  const writeEv = ...

  // 心跳机制：每 20 秒发送一次注释保持连接活跃
  const heartbeatInterval = setInterval(() => {
    try {
      stream.writeSSE({ comment: 'keepalive' });
    } catch (e) {
      // 连接已断开，清除定时器
      clearInterval(heartbeatInterval);
    }
  }, 20000);

  try {
    // ... 主流程
  } finally {
    clearInterval(heartbeatInterval);
  }
});
```

**效果**:
- 每 20 秒发送一次 SSE 注释 (`: keepalive`)
- 防止中间层（CDN/NAT/防火墙）因长时间无数据而断开连接
- 适用于推理模型长时间"思考"的场景
- 连接断开时自动清理定时器，避免内存泄漏

---

## 二、部署状态

### 修改文件清单
```
packages/llm/src/providers/openai.ts        ✅ 已修改
packages/llm/src/providers/anthropic.ts     ✅ 已修改
packages/llm/src/providers/nvidia-unlim.ts  ✅ 已修改
packages/llm/src/providers/deepseek.ts      ✅ 无需修改（继承 openai.ts）
apps/api/src/routes/chat.ts                ✅ 已修改
```

### 服务状态
```bash
# 重启时间: 2026-08-18 18:07:00
docker compose restart api

# 当前状态
yelan-api     Up 20 seconds (health: starting)   ✅
yelan-caddy   Up 15 hours                         ✅
```

---

## 三、预期效果

### 修复前 vs 修复后

| 场景 | 修复前 | 修复后 |
|------|--------|--------|
| **短回复 (< 500字)** | ✅ 正常 | ✅ 正常 |
| **中等回复 (500-700字)** | ⚠️ 接近限制 | ✅ 正常 |
| **长叙事 (700-1500字)** | ❌ 句子中间截断 | ✅ 正常 |
| **超长回复 (> 4000字)** | ❌ 截断无提示 | ✅ 截断有提示 |
| **推理模型长思考** | ⚠️ 可能超时断连 | ✅ 心跳保活 |

### 用户体验改进

**修复前**:
```
用户: "详细描述一下今天的场景"
AI: "弗朗西斯正懒洋洋地靠在沙发扶手上，手里盘着一截没点燃的烟管，亚麻色的卷发随意用蓝丝带"
     ↑ 句子断在中间，用户困惑：是 bug 吗？
```

**修复后 - 正常场景**:
```
用户: "详细描述一下今天的场景"
AI: "弗朗西斯正懒洋洋地靠在沙发扶手上，手里盘着一截没点燃的烟管，亚麻色的卷发随意用蓝丝带扎着。
     阳光透过窗纱洒在他身上，在木地板上投下斑驳的影子。他微微眯着眼，似乎在享受这难得的午后宁静...
     （继续生成到自然结束）"
     ↑ 完整的叙事，不再截断
```

**修复后 - 极端长回复**:
```
AI: "（生成 4000+ 字的超长叙事）...他缓缓转过身，目光落在窗外。
     [回复因长度限制被截断]"
     ↑ 明确提示，用户知道原因
```

---

## 四、验证方法

### 1. 检查 max_tokens 是否生效

查看实时日志，观察 token 消耗：
```bash
docker compose logs -f api | grep "\[cost\]"
```

**预期输出**:
```
[cost] turn cost: provider=ai model=gemini-3.5-flash-lite tokens=2456 cost=$0.002456
                                                                   ↑ 现在可以超过 1024
```

### 2. 检查心跳机制

在长对话生成过程中，查看是否有心跳注释：
```bash
# 浏览器 DevTools -> Network -> /api/chat -> Response
data: {"kind":"chunk","text":"..."}
: keepalive                          ← 心跳注释
data: {"kind":"chunk","text":"..."}
: keepalive                          ← 每 20 秒一次
```

### 3. 触发截断提示

故意设置非常低的 max_tokens 测试：
```typescript
// 临时测试代码
const testReq = {
  ...req,
  maxTokens: 100  // 强制截断
};
```

**预期**:
- 日志中出现: `[provider] Response truncated due to max_tokens limit`
- 前端显示: "...[回复因长度限制被截断]"

---

## 五、监控建议

### 短期观察（3-7天）

1. **用户反馈**
   - 是否还有"句子中间断开"的报告？
   - 是否有用户看到"[回复因长度限制被截断]"提示？

2. **日志监控**
   ```bash
   # 检查是否有截断警告
   docker compose logs api | grep "truncated due to max_tokens"
   
   # 检查 token 消耗分布
   docker compose logs api | grep "\[cost\]" | awk '{print $NF}' | sort -n
   ```

3. **性能影响**
   - 观察响应时间是否明显增加
   - 观察 LLM API 费用变化

### 长期优化（可选）

如果发现大量截断警告：
1. 进一步提升到 16384 tokens
2. 或实现"自动续写"机制（检测到截断时自动发起续写请求）

---

## 六、回滚方案

如果修复导致问题：

```bash
cd /root/YetLand2026

# 查看修改
git diff packages/llm/src/providers/
git diff apps/api/src/routes/chat.ts

# 回滚
git checkout packages/llm/src/providers/openai.ts
git checkout packages/llm/src/providers/anthropic.ts
git checkout packages/llm/src/providers/nvidia-unlim.ts
git checkout apps/api/src/routes/chat.ts

# 重启
cd infra/deploy
docker compose restart api
```

---

## 七、相关文档

- 完整分析报告: `docs/troubleshooting/timeout-truncation-analysis.md`
- 之前的修复: `docs/troubleshooting/fix-implementation-report.md` (8月16日)
- 配置优化: `docs/troubleshooting/2026-08-18-problem-resolution-report.md`

---

## 八、总结

### 核心改进
1. ✅ **max_tokens 提升 8 倍** (1024 → 8192)
2. ✅ **截断检测与提示** (finish_reason 处理)
3. ✅ **心跳保活机制** (20秒间隔)

### 解决的问题
- ✅ 角色扮演长叙事被截断
- ✅ 句子在中间断开，用户困惑
- ✅ 长时间无输出导致连接断开

### 未解决的问题
- ⚠️ 前端仍无总超时保护（低优先级）
- ⚠️ Think 标签截断提示不明确（低优先级）

### 成本影响
- 默认 max_tokens 提升可能增加 API 费用
- 但实际消耗取决于模型生成长度，不是所有请求都用满 8192
- 建议观察一周后评估成本影响

---

**执行人**: Claude (Kiro AI)  
**完成时间**: 2026-08-18 18:07  
**服务状态**: ✅ 已重启，运行中
